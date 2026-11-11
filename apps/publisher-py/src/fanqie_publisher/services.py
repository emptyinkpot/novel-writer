"""应用服务：账号锁、作品扫描、发布任务、远端章节编辑、发布前校验与对比。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections import defaultdict
from typing import Any, Awaitable, Callable

from .errors import ServiceError
from .guard import SessionGuardedDriver
from .store import PublicationStore, now_iso

CHAPTER_TITLE = re.compile(r"^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s+(.+)$")


class AccountLock:
    """同一番茄账号的浏览器 profile 和发布状态不能并发写；不同账号互不阻塞。"""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def run(self, account_id: str | None, task: Callable[[], Awaitable[Any]]) -> Any:
        if not account_id:
            return await task()
        async with self._locks[account_id.strip()]:
            return await task()


def normalize_title(value: Any) -> str:
    text = "" if value is None else str(value).strip()
    match = CHAPTER_TITLE.match(text)
    return match.group(1).strip() if match else text


def normalize_content(value: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", value.replace("\r\n", "\n")).strip()


def latest_number(chapters: list[dict[str, Any]]) -> int:
    return max((int(c.get("chapterNumber") or 0) for c in chapters), default=0)


def find_chapter(chapters: list[dict[str, Any]], number: int) -> dict[str, Any] | None:
    return next((c for c in chapters if int(c.get("chapterNumber") or 0) == int(number)), None)


class SessionService:
    def __init__(self, driver: SessionGuardedDriver):
        self.driver = driver

    async def reauth(self, account_id: str) -> dict[str, Any]:
        before = await self.driver.check_session(account_id, quick=True)
        if before["valid"]:
            return {"accountId": account_id, "status": "valid", "checkedAt": before["checkedAt"], "before": before, "after": before,
                    "evidence": {"skippedLogin": True, "reason": "session_already_valid"}}
        login = await self.driver.login(account_id, wait=True)
        after = await self.driver.check_session(account_id, quick=True)
        return {"accountId": account_id, "status": "valid" if after["valid"] else "failed", "checkedAt": after["checkedAt"],
                "before": before, "login": login, "after": after,
                "evidence": {"waitForCompletion": True, "beforeStatus": before["status"], "afterStatus": after["status"]}}


class ScanService:
    def __init__(self, driver: SessionGuardedDriver, store: PublicationStore, lock: AccountLock):
        self.driver, self.store, self.lock = driver, store, lock

    async def scan_works(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        works = await self.lock.run(data.get("accountId"), lambda: self.driver.scan_works(data))
        if works:
            await self.store.sync_fanqie_works(works)
        return works

    async def sync_remote_chapters(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        chapters = await self.lock.run(data.get("accountId"), lambda: self.driver.sync_remote_chapters(data))
        if chapters and data.get("persist") is not False:
            await self.store.sync_fanqie_remote_chapters(data["accountId"], str(data["bookId"]), chapters)
        return chapters


def _validate_publish(data: dict[str, Any]) -> None:
    for field in ("accountId", "bookId", "title", "content"):
        if not str(data.get(field) or "").strip():
            raise ServiceError("invalid_publish_input", f"{field} is required", 400)
    try:
        if int(data.get("chapterNumber")) <= 0:
            raise ValueError
    except (TypeError, ValueError):
        raise ServiceError("invalid_publish_input", "chapterNumber must be positive", 400) from None


def _job_id(data: dict[str, Any]) -> str:
    digest = hashlib.sha256(json.dumps({k: data.get(k) for k in ("accountId", "bookId", "chapterNumber", "title", "content", "source")},
                                       ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    return f"publish_{digest}"


class PublishService:
    """发布任务：同样内容重复提交返回同一个任务（幂等），可选择不等完成直接返回。"""

    def __init__(self, driver: SessionGuardedDriver, lock: AccountLock):
        self.driver, self.lock = driver, lock
        self.jobs: dict[str, dict[str, Any]] = {}

    async def publish_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        _validate_publish(data)
        job_id = data.get("idempotencyKey") or _job_id(data)
        existing = self.jobs.get(job_id)
        if existing:
            return {"jobId": job_id, "accepted": True, "completed": existing["status"] in ("succeeded", "failed", "cancelled"),
                    "status": existing["status"], "confirmation": existing.get("result"), "error": existing.get("error")}
        t = now_iso()
        job = {"jobId": job_id, "status": "queued", "accountId": data["accountId"], "bookId": data["bookId"],
               "chapterNumber": int(data["chapterNumber"]), "dryRun": data.get("dryRun") is True, "createdAt": t, "updatedAt": t}
        self.jobs[job_id] = job
        if data.get("waitForCompletion") is False:
            asyncio.create_task(self._run(job, data))
            return {"jobId": job_id, "accepted": True, "completed": False, "status": "queued"}
        job = await self._run(job, data)
        return {"jobId": job_id, "accepted": True, "completed": True, "status": job["status"],
                "confirmation": job.get("result"), "error": job.get("error")}

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self.jobs.get(job_id)

    async def _run(self, job: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
        job.update(status="running", startedAt=now_iso(), updatedAt=now_iso())
        try:
            if data.get("dryRun"):
                result = {"platform": "fanqie", "accountId": data["accountId"], "bookId": data["bookId"],
                          "chapterNumber": int(data["chapterNumber"]), "confirmed": False, "confirmedAt": now_iso(),
                          "evidence": {"dryRun": True}}
            else:
                result = await self.lock.run(data["accountId"], lambda: self.driver.publish_chapter(data))
            ok = bool(data.get("dryRun")) or result.get("confirmed")
            job.update(status="succeeded" if ok else "failed", result=result, finishedAt=now_iso(), updatedAt=now_iso(),
                       error=None if ok else "platform confirmation failed")
        except Exception as error:  # noqa: BLE001 - 失败要落到任务状态里
            job.update(status="failed", finishedAt=now_iso(), updatedAt=now_iso(),
                       error=error.message if isinstance(error, ServiceError) else str(error))
        return job


def _validate_identity(data: dict[str, Any]) -> None:
    for field in ("accountId", "bookId", "itemId"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ServiceError("invalid_edit_input", f"{field} is required", 400)


class EditService:
    def __init__(self, driver: SessionGuardedDriver, lock: AccountLock):
        self.driver, self.lock = driver, lock

    async def get_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        _validate_identity(data)
        return await self.lock.run(data["accountId"], lambda: self.driver.get_remote_chapter(data))

    async def edit_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        _validate_identity(data)
        title = data.get("title").strip() if isinstance(data.get("title"), str) else ""
        content = data.get("contentText").strip() if isinstance(data.get("contentText"), str) else ""
        if not title and not content:
            raise ServiceError("invalid_edit_input", "title or contentText is required", 400)
        if data.get("dryRun"):
            before = await self.get_remote_chapter(data)
            return {
                "success": True, "accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"],
                "before": before, "after": {**before, "title": title or before["title"], "contentText": content or before["contentText"]},
                "verification": {"dryRun": True,
                                 "wouldChangeTitle": bool(title and normalize_title(data["title"]) != normalize_title(before["title"])),
                                 "wouldChangeContent": bool(content and content != before["contentText"])},
                "evidence": {"dryRun": True},
            }
        return await self.lock.run(data["accountId"], lambda: self.driver.edit_remote_chapter(data))


class PlanningService:
    def __init__(self, store: PublicationStore, scan: ScanService, edit: EditService):
        self.store, self.scan, self.edit = store, scan, edit

    async def validate_database_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        resolution = await self.store.resolve_publish_chapter(data)
        chapters = await self.scan.sync_remote_chapters(
            {"accountId": resolution["accountId"], "bookId": resolution["bookId"], "refresh": True, "persist": False})
        latest = latest_number(chapters)
        chapter = resolution["chapter"]
        matching = find_chapter(chapters, chapter["chapterNumber"])
        errors, warnings = [], []
        if not chapter["title"].strip():
            errors.append("chapter title is empty")
        if not chapter["content"].strip():
            errors.append("chapter content is empty")
        if matching:
            errors.append(f"remote chapter already exists: {chapter['chapterNumber']}")
        if chapter["chapterNumber"] != latest + 1:
            warnings.append(f"chapter number is {chapter['chapterNumber']}, remote next chapter is {latest + 1}")
        if chapter.get("publishedAt"):
            warnings.append(f"database chapter has publishedAt: {chapter['publishedAt']}")
        return {"valid": not errors, "errors": errors, "warnings": warnings, "resolution": resolution,
                "remote": {"latestChapterNumber": latest, "nextChapterNumber": latest + 1, "chapterExists": bool(matching),
                           "itemId": matching.get("itemId") if matching else None}}

    async def resolve_remote_item_id(self, data: dict[str, Any], resolution: dict[str, Any]) -> str:
        if isinstance(data.get("itemId"), str) and data["itemId"].strip():
            return data["itemId"].strip()
        chapters = await self.scan.sync_remote_chapters(
            {"accountId": resolution["accountId"], "bookId": resolution["bookId"], "refresh": True, "persist": False})
        chapter = find_chapter(chapters, resolution["chapter"]["chapterNumber"])
        if not chapter or not chapter.get("itemId"):
            raise ServiceError("remote_chapter_not_found",
                               f"remote chapter itemId not found for {resolution['bookId']}#{resolution['chapter']['chapterNumber']}", 404)
        return chapter["itemId"]

    async def compare_database_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        resolution = await self.store.resolve_publish_chapter(data)
        item_id = await self.resolve_remote_item_id(data, resolution)
        remote = await self.edit.get_remote_chapter({"accountId": resolution["accountId"], "bookId": resolution["bookId"], "itemId": item_id})
        chapter = resolution["chapter"]
        db_title = data["title"] if str(data.get("title") or "").strip() else chapter["title"]
        db_content = data["contentText"] if str(data.get("contentText") or "").strip() else chapter["content"]
        return {
            "accountId": resolution["accountId"], "bookId": resolution["bookId"], "localWorkId": resolution["localWorkId"],
            "chapterNumber": chapter["chapterNumber"], "itemId": item_id,
            "titleMatched": normalize_title(db_title) == normalize_title(remote["title"]),
            "contentMatched": normalize_content(db_content) == normalize_content(remote["contentText"]),
            "database": {**chapter, "title": db_title, "content": db_content}, "remote": remote,
            "diff": {"databaseTitle": db_title, "remoteTitle": remote["title"], "databaseContentLength": len(db_content),
                     "remoteContentLength": len(remote["contentText"]), "databaseWordCount": chapter.get("wordCount"),
                     "remoteWordCount": remote.get("wordCount")},
        }

"""应用服务：账号锁、作品扫描、发布任务、远端章节编辑、发布前校验与对比。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import APIRouter

from .errors import ServiceError
from .guard import SessionGuardedDriver
from .models import AccountObject, DraftObject, WorkObject
from .store import PublicationStore, now_iso

CHAPTER_TITLE = re.compile(r"^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s+(.+)$")
log = logging.getLogger("fanqie_publisher.catalog")


class BackgroundTasks:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._failed_at: dict[str, float] = {}

    def schedule(self, key: str, operation: Callable[[], Awaitable[Any]]) -> bool:
        current = self._tasks.get(key)
        if current and not current.done():
            return False
        if asyncio.get_running_loop().time() - self._failed_at.get(key, 0) < 60:
            return False

        async def run() -> None:
            try:
                await operation()
                self._failed_at.pop(key, None)
            except Exception as error:  # noqa: BLE001
                self._failed_at[key] = asyncio.get_running_loop().time()
                log.warning("background refresh %s failed: %s", key, error)

        task = asyncio.create_task(run())
        self._tasks[key] = task
        task.add_done_callback(lambda completed: self._tasks.pop(key, None)
                               if self._tasks.get(key) is completed else None)
        return True

    def running(self, key: str) -> bool:
        task = self._tasks.get(key)
        return bool(task and not task.done())


def cache_is_stale(cached_at: str, minutes: int) -> bool:
    try:
        value = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - value).total_seconds() >= minutes * 60
    except (TypeError, ValueError):
        return True


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
    def __init__(self, driver: SessionGuardedDriver, store: PublicationStore, lock: AccountLock,
                 background: BackgroundTasks):
        self.driver, self.store, self.lock, self.background = driver, store, lock, background

    async def scan_works(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        works = await self.lock.run(data.get("accountId"), lambda: self._scan_works_locked(data))
        return works

    async def _scan_works_locked(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        works = await self.driver.scan_works(data)
        if works:
            await self.store.sync_fanqie_works(works)
        return works

    async def sync_remote_chapters(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        chapters = await self.lock.run(data.get("accountId"), lambda: self.driver.sync_remote_chapters(data))
        if chapters and data.get("persist") is not False:
            await self.store.sync_fanqie_remote_chapters(data["accountId"], str(data["bookId"]), chapters)
        return chapters

    async def cached_remote_chapters(self, account_id: str, book_id: str, *, force: bool = False) -> dict[str, Any]:
        key = f"chapters:{account_id}:{book_id}"
        cached = self.store.get_content_cache(account_id, book_id, "chapters")
        if cached and (force or cache_is_stale(cached["cachedAt"], 15)):
            self.background.schedule(key, lambda: self._refresh_chapters(account_id, book_id))
        if not cached:
            await self._refresh_chapters(account_id, book_id)
            cached = self.store.get_content_cache(account_id, book_id, "chapters")
        return {"items": cached["data"] if cached else [], "cachedAt": cached["cachedAt"] if cached else None,
                "refreshing": self.background.running(key)}

    async def _refresh_chapters(self, account_id: str, book_id: str) -> None:
        chapters = await self.lock.run(account_id, lambda: self.driver.sync_remote_chapters(
            {"accountId": account_id, "bookId": book_id, "refresh": True, "persist": False}))
        await self.store.sync_fanqie_remote_chapters(account_id, book_id, chapters)
        self.store.save_content_cache(account_id, book_id, "chapters", chapters)

    async def scan_account_catalog(self, account_id: str, *, passive: bool = False) -> dict[str, Any]:
        return await self.lock.run(account_id, lambda: self._scan_account_catalog_locked(account_id, passive=passive))

    async def _scan_account_catalog_locked(self, account_id: str, *, passive: bool = False) -> dict[str, Any]:
        scanned_at = now_iso()
        works = await self._scan_works_locked({"accountId": account_id, "passive": passive})
        results = []
        for work in works:
            book_id = str(work["bookId"])
            chapter_manage_url = (work.get("raw") or {}).get("chapterManageUrl")
            try:
                drafts = await self.driver.list_drafts({
                    "accountId": account_id,
                    "bookId": book_id,
                    "chapterManageUrl": chapter_manage_url,
                    "passive": passive,
                })
            except ServiceError as error:
                if error.code == "fanqie_login_required":
                    raise
                results.append({**work, "drafts": [], "draftScanStatus": "failed", "draftScanError": str(error),
                                "draftScannedAt": None})
            except Exception as error:  # noqa: BLE001 - keep a partial account snapshot when one book fails
                results.append({**work, "drafts": [], "draftScanStatus": "failed", "draftScanError": str(error),
                                "draftScannedAt": None})
            else:
                self.store.save_content_cache(account_id, book_id, "drafts", drafts)
                results.append({**work, "drafts": drafts, "draftScanStatus": "complete", "draftScanError": None,
                                "draftScannedAt": now_iso()})
        return {"accountId": account_id, "scannedAt": scanned_at, "works": results}


async def catalog_scan_loop(catalog, list_account_ids, interval_seconds: float) -> None:
    """Refresh account catalogs sequentially without opening interactive login windows."""
    while True:
        for account_id in await list_account_ids():
            try:
                await catalog.scan_account(account_id, passive=True)
            except Exception as error:  # noqa: BLE001
                log.warning("%s catalog refresh failed: %s", account_id, error)
        await asyncio.sleep(interval_seconds)


class CatalogService:
    def __init__(self, scan: ScanService, store: PublicationStore, background: BackgroundTasks):
        self.scan, self.store, self.background = scan, store, background

    async def list_accounts(self) -> list[dict[str, Any]]:
        accounts = await self.store.list_fanqie_accounts()
        result = []
        for row in accounts:
            account_id = row["id"]
            snapshot = self.store.get_catalog_snapshot(account_id)
            key = f"catalog:{account_id}"
            if snapshot and cache_is_stale(snapshot.get("scannedAt", ""), 15):
                self.background.schedule(key, lambda account_id=account_id: self.scan_account(account_id, passive=True))
            account = self._load_account(row).to_dict()
            account["refreshing"] = self.background.running(key)
            result.append(account)
        return result

    async def get_account(self, account_id: str) -> dict[str, Any]:
        row = await self._account_row(account_id)
        return self._load_account(row).to_dict()

    async def get_work(self, account_id: str, book_id: str) -> dict[str, Any]:
        account = AccountObject.from_dict(await self.get_account(account_id))
        work = account.get_work(book_id)
        if not work:
            raise ServiceError("catalog_work_not_found", f"账号 {account_id} 的扫描结果中没有作品 {book_id}", 404)
        return work.to_dict()

    async def scan_account(self, account_id: str, *, passive: bool = False) -> dict[str, Any]:
        row = await self._account_row(account_id)
        previous = self.store.get_catalog_snapshot(account_id)
        previous_works = {
            work.book_id: work for work in
            (WorkObject.from_dict(item) for item in (previous or {}).get("works", []))
        }
        try:
            result = await self.scan.scan_account_catalog(account_id, passive=passive)
        except ServiceError as error:
            snapshot = AccountObject.from_dict(previous or {"accountId": account_id, "name": row.get("name") or account_id})
            snapshot.scan_status = "needs_login" if error.code == "fanqie_login_required" else "failed"
            snapshot.scan_errors = [{"bookId": "", "title": "", "error": error.message}]
            data = snapshot.to_dict()
            await self.store.save_catalog_snapshot(account_id, data)
            return data

        works: list[WorkObject] = []
        scan_errors: list[dict[str, str]] = []
        for item in result["works"]:
            book_id = str(item.get("bookId") or "")
            old = previous_works.get(book_id)
            draft_status = item["draftScanStatus"]
            drafts = [DraftObject.from_dict(draft) for draft in item["drafts"]]
            draft_scanned_at = item.get("draftScannedAt")
            error = item.get("draftScanError")
            if draft_status == "failed":
                if old:
                    drafts = old.drafts
                    draft_scanned_at = old.draft_scanned_at
                scan_errors.append({"bookId": book_id, "title": str(item.get("title") or ""), "error": str(error or "草稿扫描失败")})
            raw = item.get("raw") or {}
            works.append(WorkObject(
                account_id=account_id,
                book_id=book_id,
                title=str(item.get("title") or ""),
                status=raw.get("status"),
                chapter_count=item.get("chapterCount"),
                latest_chapter_number=item.get("latestChapterNumber"),
                scanned_at=item.get("scannedAt"),
                draft_scan_status=draft_status,
                draft_scanned_at=draft_scanned_at,
                draft_scan_error=str(error) if error else None,
                chapter_manage_url=raw.get("chapterManageUrl"),
                drafts=drafts,
            ))

        snapshot = AccountObject(
            account_id=account_id,
            name=str(row.get("name") or account_id),
            scanned_at=result["scannedAt"],
            scan_status="partial" if scan_errors else "complete",
            scan_errors=scan_errors,
            works=works,
        )
        data = snapshot.to_dict()
        await self.store.save_catalog_snapshot(account_id, data)
        for work in works:
            key = f"chapters:{account_id}:{work.book_id}"
            chapter_cache = self.store.get_content_cache(account_id, work.book_id, "chapters")
            if not chapter_cache or cache_is_stale(chapter_cache["cachedAt"], 15):
                self.background.schedule(key, lambda account_id=account_id, book_id=work.book_id:
                                         self.scan._refresh_chapters(account_id, book_id))
        return data

    async def request_scan(self, account_id: str) -> dict[str, Any]:
        snapshot = self.store.get_catalog_snapshot(account_id)
        key = f"catalog:{account_id}"
        if snapshot:
            self.background.schedule(key, lambda: self.scan_account(account_id, passive=True))
            snapshot["refreshing"] = self.background.running(key)
            return snapshot
        snapshot = await self.scan_account(account_id)
        snapshot["refreshing"] = False
        return snapshot

    async def _account_row(self, account_id: str) -> dict[str, Any]:
        if not account_id or not account_id.strip():
            raise ServiceError("invalid_catalog_input", "accountId is required", 400)
        row = next((item for item in await self.store.list_fanqie_accounts() if item["id"] == account_id), None)
        if not row:
            raise ServiceError("fanqie_account_missing", f"本地没有番茄账号: {account_id}", 404)
        return row

    def _load_account(self, row: dict[str, Any]) -> AccountObject:
        data = self.store.get_catalog_snapshot(row["id"])
        if data:
            account = AccountObject.from_dict(data)
            account.name = str(row.get("name") or account.name or row["id"])
            return account
        return AccountObject(account_id=row["id"], name=str(row.get("name") or row["id"]))


def create_catalog_router(catalog: CatalogService) -> APIRouter:
    router = APIRouter(prefix="/catalog")

    @router.get("/accounts")
    async def list_accounts():
        return {"success": True, "data": await catalog.list_accounts()}

    @router.post("/accounts/{account_id}/scan")
    async def scan_account(account_id: str):
        return {"success": True, "data": await catalog.request_scan(account_id)}

    @router.get("/accounts/{account_id}")
    async def get_account(account_id: str):
        return {"success": True, "data": await catalog.get_account(account_id)}

    @router.get("/accounts/{account_id}/works/{book_id}")
    async def get_work(account_id: str, book_id: str):
        return {"success": True, "data": await catalog.get_work(account_id, book_id)}

    return router


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
            # 演练（dryRun）也会真实打开新建章节页检查表单，但不填写、不提交。
            result = await self.lock.run(data["accountId"], lambda: self.driver.publish_chapter(data))
            if data.get("dryRun"):
                problems = (result.get("evidence") or {}).get("problems") or []
                ok, error = not problems, "；".join(problems) or None
            else:
                ok, error = bool(result.get("confirmed")), None if result.get("confirmed") else "platform confirmation failed"
            job.update(status="succeeded" if ok else "failed", result=result, finishedAt=now_iso(), updatedAt=now_iso(), error=error)
        except Exception as error:  # noqa: BLE001 - 失败要落到任务状态里
            job.update(status="failed", finishedAt=now_iso(), updatedAt=now_iso(),
                       error=error.message if isinstance(error, ServiceError) else str(error))
        return job


def _validate_identity(data: dict[str, Any]) -> None:
    for field in ("accountId", "bookId", "itemId"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ServiceError("invalid_edit_input", f"{field} is required", 400)


class EditService:
    def __init__(self, driver: SessionGuardedDriver, lock: AccountLock, store: PublicationStore,
                 background: BackgroundTasks, scan: ScanService):
        self.driver, self.lock, self.store, self.background, self.scan = driver, lock, store, background, scan

    async def get_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        _validate_identity(data)
        return await self.lock.run(data["accountId"], lambda: self.driver.get_remote_chapter(data))

    async def cached_remote_chapter(self, data: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
        account_id, book_id, item_id = data["accountId"], data["bookId"], data["itemId"]
        key = f"chapter:{account_id}:{book_id}:{item_id}"
        cached = self.store.get_content_cache(account_id, book_id, "chapter", item_id)
        if cached and (force or cache_is_stale(cached["cachedAt"], 30)):
            self.background.schedule(key, lambda: self._refresh_remote_chapter(data))
        if not cached:
            await self._refresh_remote_chapter(data)
            cached = self.store.get_content_cache(account_id, book_id, "chapter", item_id)
        return {"detail": cached["data"] if cached else None,
                "cachedAt": cached["cachedAt"] if cached else None,
                "refreshing": self.background.running(key)}

    async def _refresh_remote_chapter(self, data: dict[str, Any]) -> None:
        detail = await self.get_remote_chapter(data)
        self.store.save_content_cache(data["accountId"], data["bookId"], "chapter", detail, data["itemId"])

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
        result = await self.lock.run(data["accountId"], lambda: self.driver.edit_remote_chapter(data))
        self.store.delete_content_cache(data["accountId"], data["bookId"], "chapter", data["itemId"])
        key = f"chapters:{data['accountId']}:{data['bookId']}"
        self.background.schedule(key, lambda: self.scan._refresh_chapters(data["accountId"], data["bookId"]))
        return result


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


class DraftService:
    """草稿箱：参数校验 + 同账号串行。写操作（新建、修改、删除、发布）都在驱动层读回核对。"""

    def __init__(self, driver: SessionGuardedDriver, lock: AccountLock, store: PublicationStore,
                 background: BackgroundTasks, scan: ScanService):
        self.driver, self.lock, self.store, self.background, self.scan = driver, lock, store, background, scan

    @staticmethod
    def _require(data: dict[str, Any], *fields: str) -> None:
        for name in fields:
            if not str(data.get(name) or "").strip():
                raise ServiceError("invalid_draft_input", f"{name} is required", 400)

    async def list(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        self._require(data, "accountId", "bookId")
        return await self.lock.run(data["accountId"], lambda: self.driver.list_drafts(data))

    async def cached_list(self, data: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
        account_id, book_id = data["accountId"], data["bookId"]
        key = f"drafts:{account_id}:{book_id}"
        cached = self.store.get_content_cache(account_id, book_id, "drafts")
        if cached and (force or cache_is_stale(cached["cachedAt"], 15)):
            self.background.schedule(key, lambda: self._refresh_draft_list(data))
        if not cached:
            await self._refresh_draft_list(data)
            cached = self.store.get_content_cache(account_id, book_id, "drafts")
        return {"items": cached["data"] if cached else [], "cachedAt": cached["cachedAt"] if cached else None,
                "refreshing": self.background.running(key)}

    async def _refresh_draft_list(self, data: dict[str, Any]) -> None:
        account_id, book_id = data["accountId"], data["bookId"]
        drafts = await self.list(data)
        self.store.save_content_cache(account_id, book_id, "drafts", drafts)
        snapshot = self.store.get_catalog_snapshot(account_id)
        if not snapshot:
            return
        for work in snapshot.get("works", []):
            if str(work.get("bookId")) == str(book_id):
                work["drafts"] = drafts
                work["draftCount"] = len(drafts)
                work["draftScanStatus"] = "complete"
                work["draftScanError"] = None
                work["draftScannedAt"] = now_iso()
                break
        await self.store.save_catalog_snapshot(account_id, snapshot)

    async def get(self, data: dict[str, Any]) -> dict[str, Any]:
        self._require(data, "accountId", "bookId", "itemId")
        return await self.lock.run(data["accountId"], lambda: self.driver.get_draft(data))

    async def cached_get(self, data: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
        account_id, book_id, item_id = data["accountId"], data["bookId"], data["itemId"]
        key = f"draft:{account_id}:{book_id}:{item_id}"
        cached = self.store.get_content_cache(account_id, book_id, "draft", item_id)
        if cached and (force or cache_is_stale(cached["cachedAt"], 5)):
            self.background.schedule(key, lambda: self._refresh_cached_draft(data))
        if not cached:
            await self._refresh_cached_draft(data)
            cached = self.store.get_content_cache(account_id, book_id, "draft", item_id)
        return {"detail": cached["data"] if cached else None,
                "cachedAt": cached["cachedAt"] if cached else None,
                "refreshing": self.background.running(key)}

    async def _refresh_cached_draft(self, data: dict[str, Any]) -> None:
        detail = await self.get(data)
        self.store.save_content_cache(data["accountId"], data["bookId"], "draft", detail, data["itemId"])

    async def save(self, data: dict[str, Any]) -> dict[str, Any]:
        self._require(data, "accountId", "bookId", "title", "content")
        if data.get("chapterNumber") is not None and int(data["chapterNumber"]) <= 0:
            raise ServiceError("invalid_draft_input", "chapterNumber must be positive", 400)
        result = await self.lock.run(data["accountId"], lambda: self.driver.save_draft(data))
        if result.get("itemId"):
            self.store.delete_content_cache(data["accountId"], data["bookId"], "draft", str(result["itemId"]))
        key = f"drafts:{data['accountId']}:{data['bookId']}"
        self.background.schedule(key, lambda: self._refresh_draft_list(data))
        return result

    async def update(self, data: dict[str, Any]) -> dict[str, Any]:
        self._require(data, "accountId", "bookId", "itemId")
        if data.get("title") is None and data.get("content") is None:
            raise ServiceError("invalid_draft_input", "title or content is required", 400)
        result = await self.lock.run(data["accountId"], lambda: self.driver.update_draft(data))
        self.store.delete_content_cache(data["accountId"], data["bookId"], "draft", data["itemId"])
        key = f"drafts:{data['accountId']}:{data['bookId']}"
        self.background.schedule(key, lambda: self._refresh_draft_list(data))
        return result

    async def delete(self, data: dict[str, Any]) -> dict[str, Any]:
        self._require(data, "accountId", "bookId", "itemId", "title")
        result = await self.lock.run(data["accountId"], lambda: self.driver.delete_draft(data))
        self.store.delete_content_cache(data["accountId"], data["bookId"], "draft", data["itemId"])
        key = f"drafts:{data['accountId']}:{data['bookId']}"
        self.background.schedule(key, lambda: self._refresh_draft_list(data))
        return result

    async def publish(self, data: dict[str, Any]) -> dict[str, Any]:
        self._require(data, "accountId", "bookId", "itemId")
        try:
            if int(data.get("chapterNumber")) <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise ServiceError("invalid_draft_input", "chapterNumber must be positive", 400) from None
        result = await self.lock.run(data["accountId"], lambda: self.driver.publish_draft(data))
        self.store.delete_content_cache(data["accountId"], data["bookId"], "draft", data["itemId"])
        key = f"drafts:{data['accountId']}:{data['bookId']}"
        self.background.schedule(key, lambda: self._refresh_draft_list(data))
        key = f"chapters:{data['accountId']}:{data['bookId']}"
        self.background.schedule(key, lambda: self.scan._refresh_chapters(data['accountId'], data['bookId']))
        return result

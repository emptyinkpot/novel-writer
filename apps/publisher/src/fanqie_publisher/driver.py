"""番茄平台驱动：登录态检查、登录窗口，以及把页面操作结果整理成接口返回结构。"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import time
from pathlib import Path
from typing import Any, Protocol

from playwright.async_api import async_playwright

from .browser import (
    BOOK_MANAGE_URL,
    COOKIE_URLS,
    LOGIN_URL,
    LOGIN_URL_PATTERN,
    BrowserRuntime,
    clean_browser_locks,
    cookie_identity,
    cookie_payload,
    ensure_headful_supported,
    filter_fanqie_cookies,
    has_headful_support,
    is_usable_book_manage_state,
    kill_profile_processes,
    read_page_state,
    resolve_browser_executable,
    sanitize_file_part,
)
from .config import Config
from .errors import ServiceError, driver_failed
from . import fanqie_pages as pages
from .store import now_iso

LOGIN_POLL_SECONDS = 3
IDENTITY_COOKIE_URLS = COOKIE_URLS + ["https://bytedance.com", "https://www.bytedance.com"]


class FanqieDriver(Protocol):
    configured: bool
    name: str

    async def login(self, account_id: str, wait: bool = False) -> dict[str, Any]: ...
    async def login_discovered(self) -> dict[str, Any]: ...
    async def check_session(self, account_id: str, quick: bool = False) -> dict[str, Any]: ...
    async def scan_works(self, data: dict[str, Any]) -> list[dict[str, Any]]: ...
    async def sync_remote_chapters(self, data: dict[str, Any]) -> list[dict[str, Any]]: ...
    async def publish_chapter(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def get_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def edit_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def list_drafts(self, data: dict[str, Any]) -> list[dict[str, Any]]: ...
    async def get_draft(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def save_draft(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def update_draft(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def delete_draft(self, data: dict[str, Any]) -> dict[str, Any]: ...
    async def publish_draft(self, data: dict[str, Any]) -> dict[str, Any]: ...


def sanitize_evidence(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {k: ("[redacted]" if k in ("cookies", "contentHtml", "contentText") else v) for k, v in value.items()}


def mask(uid: str) -> str:
    return uid if len(uid) <= 6 else f"{uid[:3]}***{uid[-3:]}"


def positive_or_none(value: Any) -> int | None:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


class PlaywrightFanqieDriver:
    configured = True
    name = "python-playwright"

    def __init__(self, config: Config, runtime: BrowserRuntime):
        self.config = config
        self.runtime = runtime

    async def _run(self, account_id: str | None, operation, *, headless: bool = True):
        account = self.runtime.resolve_account(account_id)
        try:
            async with self.runtime.open(account, headless=headless) as (_context, page):
                return await operation(page, account)
        except ServiceError:
            raise
        except Exception as error:  # noqa: BLE001 - 浏览器侧异常统一转成驱动失败，交给登录态守卫判断
            raise driver_failed(str(error)) from error

    # ---- 登录态 ----

    async def check_session(self, account_id: str, quick: bool = False) -> dict[str, Any]:
        checked_at = now_iso()
        if not self.runtime.account_exists(account_id):
            return {"accountId": account_id, "valid": False, "status": "missing", "checkedAt": checked_at,
                    "evidence": {"checkedAt": checked_at, "error": f"本地没有番茄账号: {account_id}"}}
        account = self.runtime.resolve_account(account_id)
        modes = [True] if quick or not has_headful_support() else [True, False]
        results = []
        for headless in modes:
            try:
                results.append(await self.runtime.capture_book_manage_state(
                    account, headless=headless, tag="session-check-headless" if headless else "session-check-headed"))
            except Exception as error:  # noqa: BLE001
                results.append({"accountId": account_id, "headless": headless, "url": "", "workCount": 0, "error": str(error)})
        usable = next((r for r in results if is_usable_book_manage_state(r)), None) or next(
            (r for r in results if not r.get("error") and "book-manage" in str(r.get("url"))
             and not LOGIN_URL_PATTERN.search(str(r.get("url")))), None)
        expired = not usable and any(LOGIN_URL_PATTERN.search(str(r.get("url") or "")) for r in results)
        return {
            "accountId": account_id,
            "valid": bool(usable),
            "status": "valid" if usable else "expired" if expired else "unknown",
            "checkedAt": checked_at,
            "evidence": {"checkedAt": checked_at, "results": [sanitize_evidence(r) for r in results]},
        }

    async def login(self, account_id: str, wait: bool = False) -> dict[str, Any]:
        """打开账号的登录窗口。wait=True 时轮询 cookie，检测到新登录态后校验身份、写回并自动关窗。"""
        ensure_headful_supported()
        account = self.runtime.resolve_account(account_id)
        if not wait:
            asyncio.create_task(self._login_window(account))
            return {"accountId": account.id, "status": "started", "headed": True, "evidence": {"message": "已打开番茄登录窗口"}}
        outcome = await self._login_window(account)
        raw = outcome.get("status")
        return {
            "accountId": account.id,
            "status": raw if raw in ("completed", "started") else "failed",
            "reason": None if raw in ("completed", "started") else raw,
            "headed": True,
            "evidence": outcome,
        }

    async def _login_window(self, account) -> dict[str, Any]:
        kill_profile_processes(account.profile_dir)
        clean_browser_locks(account.profile_dir)
        account.profile_dir.mkdir(parents=True, exist_ok=True)
        stored = cookie_identity(account.cookies)
        async with async_playwright() as pw:
            context = await pw.chromium.launch_persistent_context(
                str(account.profile_dir), headless=False, executable_path=resolve_browser_executable(),
                viewport={"width": 1400, "height": 850}, args=["--no-sandbox", "--test-type", "--window-size=1400,850"],
            )
            closed = asyncio.Event()
            context.on("close", lambda _: closed.set())
            try:
                profile_before = cookie_identity(await context.cookies(IDENTITY_COOKIE_URLS))
                baseline_uid = stored["uid"] or profile_before["uid"]
                stale_sessions = {stored["session"], profile_before["session"]} - {""}
                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto(BOOK_MANAGE_URL, wait_until="domcontentloaded", timeout=60000)
                deadline = time.monotonic() + self.config.login_timeout_seconds
                while time.monotonic() < deadline:
                    try:
                        await asyncio.wait_for(closed.wait(), timeout=LOGIN_POLL_SECONDS)
                    except asyncio.TimeoutError:
                        pass
                    if closed.is_set() or not context.pages:
                        return {"status": "cancelled", "message": "登录窗口被关闭，未检测到新的登录"}
                    cookies = await context.cookies(IDENTITY_COOKIE_URLS)
                    identity = cookie_identity(cookies)
                    if not (identity["uid"] and identity["session"]) or identity["session"] in stale_sessions:
                        continue
                    if baseline_uid and identity["uid"] != baseline_uid:
                        return {"status": "identity_mismatch", "expectedUid": mask(baseline_uid), "actualUid": mask(identity["uid"]),
                                "message": "登录的番茄账号和原账号不一致，已拒绝写入"}
                    fanqie_cookies = filter_fanqie_cookies(cookies)
                    self.runtime.store.record_account_session(account.id, cookie_payload(account.id, fanqie_cookies), name=account.name)
                    account.cookies = fanqie_cookies
                    return {"status": "completed", "cookieCount": len(fanqie_cookies), "uid": mask(identity["uid"]),
                            "message": "已检测到登录，cookie 已更新"}
                return {"status": "timeout", "message": f"等待登录超时（{self.config.login_timeout_seconds // 60} 分钟）"}
            finally:
                if not closed.is_set():
                    try:
                        await context.close()
                    except Exception:  # noqa: BLE001
                        pass

    async def login_discovered(self) -> dict[str, Any]:
        """用全新 profile 登录一个新番茄账号，按 cookie 里的 uid 生成账号 ID 并建档。"""
        ensure_headful_supported()
        profile = self.config.browser_profiles_dir / f"login-discovery-{int(time.time() * 1000):x}"
        profile.mkdir(parents=True, exist_ok=True)
        try:
            async with async_playwright() as pw:
                context = await pw.chromium.launch_persistent_context(
                    str(profile), headless=False, executable_path=resolve_browser_executable(),
                    viewport={"width": 1400, "height": 850}, args=["--no-sandbox", "--test-type", "--window-size=1400,850"],
                )
                try:
                    page = context.pages[0] if context.pages else await context.new_page()
                    await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
                    state = await self._wait_logged_in(page, context)
                    cookies = filter_fanqie_cookies(await context.cookies(IDENTITY_COOKIE_URLS))
                    if not cookies:
                        raise driver_failed("登录后未采集到番茄/头条 SSO cookie")
                    identity = cookie_identity(cookies)
                    uid_hash = hashlib.sha256((identity["uid"] or str(cookies)).encode()).hexdigest()
                    account_id = f"fanqie_{uid_hash[:16]}"
                    name = state.get("accountName") or account_id
                    self.runtime.store.record_account_session(account_id, cookie_payload(account_id, cookies), name=name,
                                                              aliases=[name] if state.get("accountName") else [])
                    return {"accountId": account_id, "status": "completed", "headed": True,
                            "evidence": {"accountName": name, "cookieCount": len(cookies), "uidHash": uid_hash, "page": state}}
                finally:
                    try:
                        await context.close()
                    except Exception:  # noqa: BLE001
                        pass
        finally:
            shutil.rmtree(profile, ignore_errors=True)

    async def _wait_logged_in(self, page, context) -> dict[str, Any]:
        deadline = time.monotonic() + self.config.login_timeout_seconds
        state: dict[str, Any] = {}
        log_path = self.config.acceptance_dir / "login-discovery.log"
        while time.monotonic() < deadline:
            state = await read_page_state(page)
            if self._looks_logged_in(state):
                return state
            cookies = await context.cookies(IDENTITY_COOKIE_URLS)
            identity = cookie_identity(cookies)
            # 记录检测过程，登录卡住时据此定位：页面停在哪、登录 cookie 有没有出现。
            with log_path.open("a", encoding="utf-8") as log_file:
                log_file.write(f"{now_iso()} url={state.get('url')} works={state.get('workCount')} "
                               f"uid={'有' if identity['uid'] else '无'} session={'有' if identity['session'] else '无'} "
                               f"cookies={sorted({c.get('name') for c in cookies})[:30]}\n")
            if identity["uid"] and identity["session"]:
                try:
                    await page.goto(BOOK_MANAGE_URL, wait_until="domcontentloaded", timeout=60000)
                except Exception:  # noqa: BLE001
                    pass
                await page.wait_for_timeout(2500)
                state = await read_page_state(page)
                if self._looks_logged_in(state):
                    return state
            await page.wait_for_timeout(2500)
        raise ServiceError("fanqie_login_timeout", f"等待用户登录超时；最后页面={state.get('url') or page.url}", 401)

    @staticmethod
    def _looks_logged_in(state: dict[str, Any]) -> bool:
        url = str(state.get("url") or "")
        if LOGIN_URL_PATTERN.search(url) or "/main/writer/book-manage" not in url:
            return False
        return int(state.get("workCount") or 0) > 0 or any(w in str(state.get("textPreview") or "") for w in ("作品", "书籍", "创建", "草稿", "章节"))

    # ---- 需要登录态的操作 ----

    async def scan_works(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        items = await self._run(data.get("accountId"), lambda page, _a: pages.list_works(page), headless=not data.get("headed"))
        scanned_at = now_iso()
        account_id = str(data.get("accountId") or "")
        works = [{
            "accountId": account_id or str(item.get("accountId") or ""), "platform": "fanqie", "bookId": str(item.get("id") or ""),
            "title": str(item.get("title") or ""), "chapterCount": positive_or_none(item.get("chapterCount")),
            "latestChapterNumber": positive_or_none(item.get("latestChapterNumber")), "scannedAt": scanned_at,
            "raw": sanitize_evidence(item),
        } for item in items]
        return [w for w in works if w["bookId"] and w["title"]]

    async def sync_remote_chapters(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        book_id = str(data["bookId"])
        items = await self._run(data["accountId"], lambda page, _a: pages.list_remote_chapters(page, book_id))
        synced_at = now_iso()
        chapters = [{
            "accountId": data["accountId"], "platform": "fanqie", "bookId": book_id,
            "itemId": str(item["itemId"]) if item.get("itemId") else None, "chapterNumber": int(item.get("chapterNumber") or 0),
            "title": item.get("title"), "wordCount": positive_or_none(item.get("wordCount")),
            "publishedAt": item.get("publishedAt") or None, "syncedAt": synced_at, "raw": sanitize_evidence(item),
        } for item in items]
        return [c for c in chapters if c["itemId"] and c["chapterNumber"] > 0]

    async def publish_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        evidence_dir = self.config.acceptance_dir / "publish"
        action = pages.inspect_publish_form if data.get("dryRun") else pages.publish_chapter
        result = await self._run(
            data["accountId"],
            lambda page, account: action(page, data, account.id, evidence_dir),
            headless=data.get("headless") is not False,
        )
        if data.get("dryRun"):
            return {"platform": "fanqie", "accountId": data["accountId"], "bookId": str(data["bookId"]),
                    "chapterNumber": int(data["chapterNumber"]), "confirmed": False, "confirmedAt": now_iso(),
                    "evidence": sanitize_evidence(result)}
        return {
            "platform": "fanqie", "accountId": data["accountId"], "bookId": str(result.get("bookId") or data["bookId"]),
            "chapterNumber": int(data["chapterNumber"]), "confirmed": result.get("confirmed") is True,
            "confirmedAt": now_iso(), "evidence": sanitize_evidence(result),
        }

    async def get_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        detail = await self._run(data["accountId"], lambda page, _a: pages.get_remote_chapter_detail(page, data["bookId"], data["itemId"]))
        return {
            "accountId": data["accountId"], "bookId": str(detail.get("bookId") or data["bookId"]),
            "itemId": str(detail.get("itemId") or data["itemId"]), "editUrl": detail.get("editUrl"),
            "chapterNumber": positive_or_none(detail.get("chapterNumber")), "title": str(detail.get("title") or ""),
            "contentHtml": detail.get("contentHtml") or None, "contentText": str(detail.get("contentText") or ""),
            "wordCount": positive_or_none(detail.get("wordCount")), "responseCode": detail.get("responseCode"),
            "responseMessage": detail.get("responseMessage") or None, "evidence": sanitize_evidence(detail),
        }

    async def edit_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        evidence_dir = self.config.acceptance_dir / "remote-edit"
        result = await self._run(
            data["accountId"],
            lambda page, account: pages.update_remote_chapter(
                page, data["bookId"], data["itemId"], {"title": data.get("title"), "contentText": data.get("contentText")},
                account.id, evidence_dir),
        )
        return {
            "success": result.get("success") is True, "accountId": data["accountId"],
            "bookId": str(result.get("bookId") or data["bookId"]), "itemId": str(result.get("itemId") or data["itemId"]),
            "before": result.get("before"), "after": result.get("after"), "listEntry": result.get("listEntry"),
            "verification": result.get("verification"), "evidence": sanitize_evidence(result),
        }

    # ---- 草稿箱 ----

    async def list_drafts(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        book_id = str(data["bookId"])
        items = await self._run(data["accountId"], lambda page, _a: pages.list_drafts(
            page, book_id, data.get("chapterManageUrl")))
        return [{"accountId": data["accountId"], "bookId": book_id, **item} for item in items]

    async def get_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        detail = await self._run(data["accountId"], lambda page, _a: pages.get_draft(page, str(data["bookId"]), str(data["itemId"])))
        return {
            "accountId": data["accountId"], "bookId": str(data["bookId"]), "itemId": str(data["itemId"]),
            "title": str(detail.get("title") or ""), "chapterNumber": positive_or_none(detail.get("chapterNumber")),
            "wordCount": positive_or_none(detail.get("wordCount")), "contentText": str(detail.get("contentText") or ""),
            "editUrl": detail.get("editUrl"), "responseCode": detail.get("responseCode"),
        }

    async def save_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        result = await self._run(data["accountId"], lambda page, _a: pages.save_new_draft(
            page, str(data["bookId"]), str(data["title"]), str(data["content"]), data.get("chapterNumber")))
        return {"accountId": data["accountId"], **result}

    async def update_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        result = await self._run(data["accountId"], lambda page, _a: pages.update_draft(
            page, str(data["bookId"]), str(data["itemId"]), data.get("title"), data.get("content")))
        return {"accountId": data["accountId"], **result}

    async def delete_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        result = await self._run(data["accountId"], lambda page, _a: pages.delete_draft(
            page, str(data["bookId"]), str(data["itemId"]), str(data["title"])))
        return {"accountId": data["accountId"], **result}

    async def publish_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        evidence_dir = self.config.acceptance_dir / "publish"
        result = await self._run(
            data["accountId"],
            lambda page, account: pages.publish_draft(page, str(data["bookId"]), str(data["itemId"]), int(data["chapterNumber"]),
                                                      data.get("dryRun") is True, account.id, evidence_dir),
            headless=data.get("headless") is not False,
        )
        return {"accountId": data["accountId"], **result}

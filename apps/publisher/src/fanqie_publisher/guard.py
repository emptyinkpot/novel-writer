"""番茄登录态守卫。

所有需要登录的操作都经过这里：
  1. 执行前快速检查（headless，不弹窗；通过后缓存一段时间）；
  2. 已过期 → 打开登录窗口，等待登录并确认 cookie 已更新；
  3. 执行中失败 → 复查登录态，确认是过期导致的才重新登录并重试一次。
同一账号同时只开一个登录窗口，并发任务共享这一次登录。网络错误等无法判定的情况不触发登录。
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

from .driver import FanqieDriver
from .errors import ServiceError
from .store import now_iso

log = logging.getLogger("fanqie_publisher.session")

LOGIN_FAILURE_MESSAGES = {
    "cancelled": "登录窗口被关闭，未完成登录",
    "timeout": "等待番茄登录超时",
    "identity_mismatch": "登录的番茄账号与原账号不一致，已拒绝更新 cookie",
}


class SessionGuardedDriver:
    def __init__(self, inner: FanqieDriver, *, cache_seconds: float = 600, auto_relogin: bool = True):
        self.inner = inner
        self.configured = inner.configured
        self.name = inner.name
        self.cache_seconds = cache_seconds
        self.auto_relogin = auto_relogin
        self._valid_until: dict[str, float] = {}
        self._pending_logins: dict[str, asyncio.Task] = {}
        self._states: dict[str, dict[str, Any]] = {}

    # ---- 状态 ----

    def get_state(self, account_id: str) -> dict[str, Any]:
        return self._states.get(account_id, {"accountId": account_id, "status": "unknown"})

    def list_states(self) -> list[dict[str, Any]]:
        return list(self._states.values())

    async def refresh_state(self, account_id: str) -> dict[str, Any]:
        """后台巡检用：只检查并记录状态，从不打开窗口。"""
        if account_id in self._pending_logins:
            return self.get_state(account_id)
        await self._check(account_id)
        return self.get_state(account_id)

    def _set_state(self, account_id: str, status: str, message: str | None = None, checked_at: str | None = None) -> None:
        self._states[account_id] = {"accountId": account_id, "status": status, "checkedAt": checked_at or now_iso(), "message": message}

    def _record(self, result: dict[str, Any]) -> None:
        account_id = result["accountId"]
        if result.get("valid"):
            self._valid_until[account_id] = time.monotonic() + self.cache_seconds
        else:
            self._valid_until.pop(account_id, None)
        self._set_state(account_id, result["status"], None, result.get("checkedAt"))

    async def _check(self, account_id: str) -> dict[str, Any]:
        result = await self.inner.check_session(account_id, quick=True)
        self._record(result)
        return result

    # ---- 透传 ----

    async def login(self, account_id: str, wait: bool = False) -> dict[str, Any]:
        return await self.inner.login(account_id, wait)

    async def login_discovered(self) -> dict[str, Any]:
        return await self.inner.login_discovered()

    async def check_session(self, account_id: str, quick: bool = False) -> dict[str, Any]:
        result = await self.inner.check_session(account_id, quick)
        self._record(result)
        return result

    # ---- 需要登录态的操作 ----

    async def scan_works(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        if not data.get("accountId"):
            return await self.inner.scan_works(data)
        return await self._guard(data["accountId"], lambda: self.inner.scan_works(data), passive=data.get("passive") is True)

    async def sync_remote_chapters(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._guard(data["accountId"], lambda: self.inner.sync_remote_chapters(data))

    async def publish_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.publish_chapter(data))

    async def get_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.get_remote_chapter(data))

    async def edit_remote_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.edit_remote_chapter(data))

    async def list_drafts(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._guard(data["accountId"], lambda: self.inner.list_drafts(data), passive=data.get("passive") is True)

    async def get_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.get_draft(data))

    async def save_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.save_draft(data))

    async def update_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.update_draft(data))

    async def delete_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.delete_draft(data))

    async def publish_draft(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._guard(data["accountId"], lambda: self.inner.publish_draft(data))

    # ---- 核心 ----

    async def ensure_session(self, account_id: str, force: bool = False, *, allow_relogin: bool = True) -> None:
        if not force and self._valid_until.get(account_id, 0) > time.monotonic():
            return
        result = await self._check(account_id)
        if result["status"] in ("valid", "unknown"):
            return
        if result["status"] == "missing":
            raise ServiceError("fanqie_account_missing", f"本地没有番茄账号 {account_id}，需要先完成一次番茄登录", 404, result)
        if not allow_relogin:
            self._set_state(account_id, result["status"], "登录态不可用，后台刷新不会打开登录窗口", result.get("checkedAt"))
            raise ServiceError("fanqie_login_required", f"番茄账号 {account_id} 登录态需要更新", 401, result)
        await self._relogin(account_id)

    async def _guard(self, account_id: str, operation: Callable[[], Awaitable[Any]], *, passive: bool = False) -> Any:
        await self.ensure_session(account_id, allow_relogin=not passive)
        try:
            return await operation()
        except ServiceError as error:
            if error.code not in ("fanqie_driver_failed", "invalid_driver_output"):
                raise
            self._valid_until.pop(account_id, None)
            try:
                recheck = await self._check(account_id)
            except Exception:  # noqa: BLE001
                raise error from None
            if recheck["status"] != "expired":
                raise
            if passive:
                self._set_state(account_id, "expired", "登录态已失效，后台刷新不会打开登录窗口", recheck.get("checkedAt"))
                raise ServiceError("fanqie_login_required", f"番茄账号 {account_id} 登录态需要更新", 401, recheck)
            log.info("%s 操作中途登录态失效，重新登录后重试一次", account_id)
            await self._relogin(account_id)
            return await operation()

    async def _relogin(self, account_id: str) -> None:
        task = self._pending_logins.get(account_id)
        if task is None:
            task = asyncio.ensure_future(self._do_relogin(account_id))
            self._pending_logins[account_id] = task
            task.add_done_callback(lambda _t: self._pending_logins.pop(account_id, None))
        await asyncio.shield(task)

    async def _do_relogin(self, account_id: str) -> None:
        self._valid_until.pop(account_id, None)
        if not self.auto_relogin:
            self._set_state(account_id, "expired", "登录态已失效，自动登录已关闭")
            raise ServiceError("fanqie_login_required", f"番茄账号 {account_id} 登录态已失效", 401)
        self._set_state(account_id, "waiting_login", "已打开番茄登录窗口，等待登录")
        log.info("%s 登录态失效，已打开登录窗口，等待登录", account_id)
        try:
            login = await self.inner.login(account_id, wait=True)
        except Exception as error:  # noqa: BLE001
            self._set_state(account_id, "login_failed", str(error))
            raise ServiceError("fanqie_login_failed", f"无法打开番茄登录窗口：{error}", 503) from error
        if login.get("status") != "completed":
            reason = login.get("reason") or "failed"
            message = LOGIN_FAILURE_MESSAGES.get(reason, "番茄登录未完成")
            self._set_state(account_id, "login_failed", message)
            raise ServiceError(f"fanqie_login_{reason}", message, 401, login.get("evidence"))
        after = await self._check(account_id)
        if after["status"] != "valid":
            self._set_state(account_id, "login_failed", "登录后校验未通过")
            raise ServiceError("fanqie_relogin_unverified", f"番茄账号 {account_id} 登录后校验未通过（{after['status']}）", 401,
                               after.get("evidence"))
        log.info("%s 登录成功，cookie 已更新", account_id)


async def session_watch_loop(guard: SessionGuardedDriver, list_account_ids: Callable[[], Awaitable[list[str]]],
                             run_exclusive: Callable[[str, Callable[[], Awaitable[Any]]], Awaitable[Any]], interval_seconds: float) -> None:
    """后台巡检：定期快速检查所有账号，只更新状态，不弹窗。"""
    while True:
        await asyncio.sleep(interval_seconds)
        for account_id in await list_account_ids():
            try:
                state = await run_exclusive(account_id, lambda a=account_id: guard.refresh_state(a))
                if state.get("status") == "expired":
                    log.info("%s 登录态已失效，下次需要登录的任务会打开登录窗口", account_id)
            except Exception as error:  # noqa: BLE001
                log.warning("%s 检查失败：%s", account_id, error)

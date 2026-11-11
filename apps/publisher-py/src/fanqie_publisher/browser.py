"""浏览器运行时：定位浏览器、按账号隔离 profile、注入/回写 cookie、采集作者后台页面状态。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator

import psutil
from playwright.async_api import BrowserContext, Page, async_playwright

from .config import Config
from .errors import ServiceError, driver_failed
from .store import PublicationStore, now_iso

BOOK_MANAGE_URL = "https://fanqienovel.com/main/writer/book-manage"
LOGIN_URL = "https://fanqienovel.com/main/writer/login"
COOKIE_URLS = [
    "https://fanqienovel.com",
    "https://fanqienovel.com/main/writer/book-manage",
    "https://sso.toutiao.com",
    "https://www.toutiao.com",
]
WORK_ITEM_SELECTOR = '[id^="long-article-table-item-"]'
LOGIN_URL_PATTERN = re.compile(r"/main/writer/login|passport\.|/login\b|sso\.", re.I)


def sanitize_file_part(value: Any) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "unknown"))


def resolve_browser_executable() -> str | None:
    """优先显式配置，其次本机 Edge/Chrome；都没有时返回 None，交给 Playwright 自带的 Chromium。"""
    candidates = [os.environ.get("FANQIE_BROWSER_EXECUTABLE")]
    if sys.platform == "win32":
        candidates += [
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
        ]
    elif sys.platform.startswith("linux"):
        candidates += ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
    else:
        candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                       "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def has_headful_support() -> bool:
    if not sys.platform.startswith("linux"):
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def ensure_headful_supported() -> None:
    if not has_headful_support():
        raise ServiceError("headful_unavailable", "Linux 无图形会话，无法执行有头登录；请设置 DISPLAY/WAYLAND_DISPLAY", 503)


def clean_browser_locks(profile_dir: Path) -> None:
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie", "Lock", "lockfile"):
        try:
            (profile_dir / name).unlink()
        except OSError:
            pass


def list_profile_processes(profile_dir: Path) -> list[psutil.Process]:
    """只找命令行里带这个 profile 目录的浏览器进程，不碰用户的其他窗口。"""
    needle = str(profile_dir).lower().replace("\\", "/")
    found = []
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if not re.search(r"msedge|chrome|chromium", name):
                continue
            cmdline = " ".join(proc.info.get("cmdline") or []).lower().replace("\\", "/")
            if needle in cmdline:
                found.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return found


def kill_profile_processes(profile_dir: Path) -> int:
    procs = list_profile_processes(profile_dir)
    for proc in procs:
        try:
            proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return len(procs)


def cookie_identity(cookies: list[dict[str, Any]] | None) -> dict[str, str]:
    """只取身份相关 cookie：uid 判定是哪个番茄账号，session 判定是否换了新登录。"""
    values = {str(c.get("name") or ""): str(c.get("value") or "") for c in cookies or []}
    return {
        "uid": values.get("uid_tt") or values.get("uid_tt_ss") or "",
        "session": values.get("sessionid") or values.get("sessionid_ss") or values.get("sid_tt") or "",
    }


def filter_fanqie_cookies(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [c for c in cookies if re.search(r"fanqie|toutiao|bytedance", str(c.get("domain") or "").lower())]


def cookie_payload(account_id: str, cookies: list[dict[str, Any]]) -> dict[str, Any]:
    expires = [float(c.get("expires") or 0) for c in cookies if float(c.get("expires") or 0) > 0]
    checksum = hashlib.sha256(json.dumps(cookies, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return {
        "schemaVersion": 1,
        "kind": "fanqie.cookies",
        "accountId": account_id,
        "savedAt": now_iso(),
        "cookieCount": len(cookies),
        "checksum": checksum,
        "expiresSummary": {
            "domains": sorted({str(c.get("domain") or "") for c in cookies if c.get("domain")}),
            "cookieCount": len(cookies),
            "maxExpires": max(expires) if expires else None,
            "sessionCookieCount": len(cookies) - len(expires),
        },
        "cookies": cookies,
    }


@dataclass
class Account:
    id: str
    name: str
    profile_dir: Path
    cookies: list[dict[str, Any]] = field(default_factory=list)


class BrowserRuntime:
    """所有浏览器操作的入口。一个账号一个 profile；cookie 以本地存储为准，profile 只是缓存。"""

    def __init__(self, config: Config, store: PublicationStore):
        self.config = config
        self.store = store

    def resolve_account(self, account_id: str | None) -> Account:
        rows = self.store.list_account_rows()
        row = next((r for r in rows if r["accountId"] == account_id), None) if account_id else (rows[0] if rows else None)
        if not row:
            raise ServiceError("fanqie_account_missing", f"本地没有番茄账号: {account_id or '(default)'}，需要先完成一次番茄登录", 404)
        return Account(
            id=row["accountId"],
            name=row["name"] or row["accountId"],
            profile_dir=self.config.browser_profiles_dir / sanitize_file_part(row["accountId"]),
            cookies=self.store.account_cookies(row["accountId"]),
        )

    def account_exists(self, account_id: str) -> bool:
        return self.store.get_account(account_id) is not None

    @asynccontextmanager
    async def open(self, account: Account, *, headless: bool = True, viewport=(1800, 1400),
                   persist: bool = True) -> AsyncIterator[tuple[BrowserContext, Page]]:
        """启动账号的持久化 profile，注入本地 cookie；退出时回写 cookie 并关闭浏览器。"""
        account.profile_dir.mkdir(parents=True, exist_ok=True)
        async with async_playwright() as pw:
            context = None
            last_error: Exception | None = None
            for attempt in range(1, 4):
                clean_browser_locks(account.profile_dir)
                if attempt > 1:
                    kill_profile_processes(account.profile_dir)
                    clean_browser_locks(account.profile_dir)
                    await asyncio.sleep(0.8 * attempt)
                try:
                    context = await pw.chromium.launch_persistent_context(
                        str(account.profile_dir),
                        headless=headless,
                        executable_path=resolve_browser_executable(),
                        viewport={"width": viewport[0], "height": viewport[1]},
                        args=["--no-sandbox", "--test-type", f"--window-size={viewport[0]},{viewport[1]}"],
                    )
                    break
                except Exception as error:  # noqa: BLE001 - 浏览器启动失败要按类型决定是否重试
                    last_error = error
                    if not re.search(r"ProcessSingleton|already in use|SingletonLock|closed|ECONNRESET|ETIMEDOUT", str(error), re.I):
                        break
            if context is None:
                raise driver_failed(f"浏览器启动失败: {last_error}")
            try:
                await self.hydrate_cookies(context, account)
                page = context.pages[0] if context.pages else await context.new_page()
                yield context, page
            finally:
                if persist:
                    await self.persist_context_cookies(context, account)
                try:
                    await context.close()
                except Exception:  # noqa: BLE001
                    pass

    @staticmethod
    async def hydrate_cookies(context: BrowserContext, account: Account) -> int:
        """只补 profile 里缺的 cookie；profile 里已有的（往往是刚登录的新 cookie）保留不覆盖。"""
        if not account.cookies:
            return 0
        try:
            existing = await context.cookies()
        except Exception:  # noqa: BLE001
            existing = []
        keys = {(c.get("name"), c.get("domain"), c.get("path") or "/") for c in existing}
        to_add = [c for c in account.cookies if (c.get("name"), c.get("domain"), c.get("path") or "/") not in keys]
        if to_add:
            try:
                await context.add_cookies(to_add)
            except Exception:  # noqa: BLE001
                return 0
        return len(to_add)

    async def persist_context_cookies(self, context: BrowserContext, account: Account) -> int:
        try:
            cookies = await context.cookies(COOKIE_URLS)
        except Exception:  # noqa: BLE001
            return 0
        # 没有登录 session 的 cookie（已过期/被清掉）不回写，避免覆盖掉账号原有的身份信息。
        if not cookies or not cookie_identity(cookies)["session"]:
            return 0
        self.store.record_account_session(account.id, cookie_payload(account.id, cookies), name=account.name)
        account.cookies = cookies
        return len(cookies)

    async def capture_book_manage_state(self, account: Account, *, headless: bool, tag: str) -> dict[str, Any]:
        """打开作者后台作品管理页，记录 URL 和作品数，并保存截图作为证据。"""
        state: dict[str, Any] = {"accountId": account.id, "accountName": account.name, "headless": headless}
        async with self.open(account, headless=headless, viewport=(1400, 850), persist=False) as (context, page):
            error = None
            try:
                await page.goto(BOOK_MANAGE_URL, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(5000)
            except Exception as exc:  # noqa: BLE001
                error = str(exc)
            state.update(await read_page_state(page))
            state["error"] = error
            base = self.config.acceptance_dir / f"{sanitize_file_part(account.id)}-{sanitize_file_part(tag)}"
            try:
                await page.screenshot(path=f"{base}.png", full_page=True)
            except Exception:  # noqa: BLE001
                pass
            state["statePath"] = f"{base}-state.json"
            if is_usable_book_manage_state(state):
                state["cookiePersistedCount"] = await self.persist_context_cookies(context, account)
            Path(state["statePath"]).write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return state


async def read_page_state(page: Page) -> dict[str, Any]:
    try:
        return await page.evaluate(
            """() => ({
                url: location.href,
                title: document.title,
                workCount: document.querySelectorAll('[id^="long-article-table-item-"]').length,
                textPreview: (document.body?.innerText || '').slice(0, 500),
            })"""
        )
    except Exception:  # noqa: BLE001
        return {"url": page.url, "title": "", "workCount": 0, "textPreview": ""}


def is_usable_book_manage_state(state: dict[str, Any]) -> bool:
    """能看到作品列表才算登录态可用；登录页或空列表都不算。"""
    if LOGIN_URL_PATTERN.search(str(state.get("url") or "")):
        return False
    return int(state.get("workCount") or 0) > 0

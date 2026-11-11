from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest

from fanqie_publisher.config import Config
from fanqie_publisher.errors import ServiceError, driver_failed
from fanqie_publisher.store import PublicationStore, now_iso


def make_config(tmp: Path) -> Config:
    return Config(host="127.0.0.1", port=0, data_dir=tmp, service_dir=tmp / "publisher", publisher_db=tmp / "publisher.sqlite",
                  library_db=tmp / "novel-writer.sqlite", session_cache_seconds=600, auto_relogin=True,
                  session_watch_minutes=0, catalog_scan_minutes=0, login_timeout_seconds=600)


def make_library(path: Path, chapters: list[tuple[str, str]], work_id: int = 1) -> None:
    """建一个最小的 novel-writer 作品库，只含 nw_chapters 表。"""
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS nw_chapters (id INTEGER PRIMARY KEY, work_id INTEGER, title TEXT, content TEXT, sort_order INTEGER)")
    for index, (title, content) in enumerate(chapters, start=1):
        conn.execute("INSERT INTO nw_chapters (work_id, title, content, sort_order) VALUES (?, ?, ?, ?)", (work_id, title, content, index))
    conn.commit()
    conn.close()


class FakeDriver:
    """可编排的假驱动：按顺序返回登录态检查结果，记录调用。"""

    configured = True
    name = "fake"

    def __init__(self) -> None:
        self.checks: list[str] = []
        self.login_status = "completed"
        self.login_reason: str | None = None
        self.login_delay = 0.0
        self.publish_failures = 0
        self.calls: list[str] = []
        self.remote_chapters: list[dict[str, Any]] = []

    async def check_session(self, account_id: str, quick: bool = False) -> dict[str, Any]:
        status = self.checks.pop(0) if self.checks else "valid"
        self.calls.append(f"check:{status}")
        return {"accountId": account_id, "valid": status == "valid", "status": status, "checkedAt": now_iso()}

    async def login(self, account_id: str, wait: bool = False) -> dict[str, Any]:
        import asyncio
        self.calls.append("login")
        if self.login_delay:
            await asyncio.sleep(self.login_delay)
        return {"accountId": account_id, "status": self.login_status, "reason": self.login_reason, "headed": True}

    async def login_discovered(self) -> dict[str, Any]:
        raise ServiceError("driver_not_configured", "not in tests", 501)

    async def scan_works(self, data):
        self.calls.append("scan")
        return [{"accountId": data.get("accountId"), "platform": "fanqie", "bookId": "7001", "title": "雾港来信",
                 "chapterCount": 1, "latestChapterNumber": 1, "scannedAt": now_iso()}]

    async def sync_remote_chapters(self, data):
        self.calls.append("sync")
        return list(self.remote_chapters)

    async def publish_chapter(self, data):
        self.calls.append("publish")
        if self.publish_failures > 0:
            self.publish_failures -= 1
            raise driver_failed("page redirected")
        return {"platform": "fanqie", "accountId": data["accountId"], "bookId": data["bookId"], "chapterNumber": int(data["chapterNumber"]),
                "confirmed": True, "confirmedAt": now_iso(), "evidence": {"matchedChapter": {"itemId": "item-new"}}}

    async def get_remote_chapter(self, data):
        self.calls.append("detail")
        return {"accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"], "title": "第1章 雾起",
                "contentText": "旧正文", "wordCount": 3}

    async def list_drafts(self, data):
        self.calls.append("drafts")
        return [{"accountId": data["accountId"], "bookId": data["bookId"], "itemId": "d1", "title": "第 章 测试草稿", "wordCount": 12}]

    async def get_draft(self, data):
        self.calls.append("draft")
        return {"accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"], "title": "测试草稿", "contentText": "正文"}

    async def save_draft(self, data):
        self.calls.append("save_draft")
        return {"accountId": data["accountId"], "bookId": data["bookId"], "itemId": "d-new", "verification": {"verified": True}}

    async def update_draft(self, data):
        self.calls.append("update_draft")
        return {"accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"], "verification": {"verified": True}}

    async def delete_draft(self, data):
        self.calls.append("delete_draft")
        return {"accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"], "deleted": True}

    async def publish_draft(self, data):
        self.calls.append("publish_draft")
        return {"accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"],
                "dryRun": data.get("dryRun") is True, "success": True, "problems": []}

    async def edit_remote_chapter(self, data):
        self.calls.append("edit")
        return {"success": True, "accountId": data["accountId"], "bookId": data["bookId"], "itemId": data["itemId"]}


@pytest.fixture
def tmp_data(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def store(tmp_path: Path) -> PublicationStore:
    return PublicationStore(tmp_path / "publisher.sqlite", library_db=tmp_path / "novel-writer.sqlite")

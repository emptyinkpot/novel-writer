"""本地发布存储：番茄账号与 cookie、发布目标、远端作品/章节快照、发布记录。

表结构与 TS 版完全一致，data/publisher.sqlite 可以直接共用。
待发布章节只读取 novel-writer 自己的作品库（data/novel-writer.sqlite 的 nw_chapters）。
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Protocol

from .errors import ServiceError

SCHEMA = """
CREATE TABLE IF NOT EXISTS fanqie_accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  cookies_payload TEXT,
  cookie_checksum TEXT,
  cookie_count INTEGER,
  expires_summary TEXT,
  session_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_targets (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'fanqie',
  account_identity TEXT NOT NULL,
  local_work_id TEXT NOT NULL,
  remote_work_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, account_identity, remote_work_id)
);
CREATE TABLE IF NOT EXISTS fanqie_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  title TEXT,
  chapter_count INTEGER,
  latest_chapter_number INTEGER,
  raw TEXT,
  scanned_at TEXT NOT NULL,
  UNIQUE (account_id, work_id)
);
CREATE TABLE IF NOT EXISTS fanqie_remote_chapters (
  account_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  item_id TEXT,
  title TEXT,
  word_count INTEGER,
  published_at TEXT,
  raw TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (account_id, book_id, chapter_number)
);
CREATE TABLE IF NOT EXISTS publication_records (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  local_work_id TEXT NOT NULL,
  chapter_id INTEGER,
  chapter_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  remote_part_id TEXT,
  observed_status TEXT NOT NULL,
  published_at TEXT,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publication_records_target ON publication_records (target_id, chapter_number);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_json(text: Any, fallback: Any) -> Any:
    if not text:
        return fallback
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return fallback


def blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def required(value: Any, field: str) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        raise ServiceError("publish_resolution_failed", f"{field} is required", 422)
    return text


def normalize_limit(value: Any, default: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return default
    return default if parsed <= 0 else min(parsed, 500)


def count_words(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def connect(path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


# ---------------------------------------------------------------------------
# 章节来源
# ---------------------------------------------------------------------------

class ChapterSource(Protocol):
    def list_chapters(self, local_work_id: str) -> list[dict[str, Any]]: ...


@dataclass
class SqliteLibraryChapterSource:
    """读取 novel-writer 作品库。章节号 = 按 sort_order、id 排序后的序号。"""

    path: Path

    def list_chapters(self, local_work_id: str) -> list[dict[str, Any]]:
        if not self.path.exists():
            raise ServiceError("library_not_found", "本地作品库不存在：先启动 apps/api 并创建作品", 404)
        conn = sqlite3.connect(f"file:{self.path.as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, work_id, title, content FROM nw_chapters WHERE work_id = ? ORDER BY sort_order, id",
                (int(local_work_id),),
            ).fetchall()
        finally:
            conn.close()
        return [
            {
                "id": str(row["id"]),
                "workId": str(row["work_id"]),
                "chapterNumber": index + 1,
                "title": row["title"] or "",
                "content": row["content"] or "",
                "wordCount": count_words(row["content"] or ""),
            }
            for index, row in enumerate(rows)
        ]


# ---------------------------------------------------------------------------
# 存储
# ---------------------------------------------------------------------------

class PublicationStore:
    def __init__(self, db_path: Path | str, chapters: ChapterSource | None = None, library_db: Path | None = None):
        self.db = connect(db_path)
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)
        self.chapters = chapters or SqliteLibraryChapterSource(library_db or Path(str(db_path)).with_name("novel-writer.sqlite"))

    # ---- 账号与 cookie ----

    @staticmethod
    def _account_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "accountId": row["account_id"],
            "id": row["account_id"],
            "name": row["name"],
            "aliases": parse_json(row["aliases"], []),
            "status": row["status"],
            "cookieChecksum": row["cookie_checksum"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "session": {
                "cookiesPayload": row["cookies_payload"],
                "cookieCount": row["cookie_count"],
                "syncedAt": row["session_synced_at"],
                "expiresSummary": parse_json(row["expires_summary"], None),
            },
        }

    def get_account(self, account_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM fanqie_accounts WHERE account_id = ?", (account_id,)).fetchone()
        return self._account_row(row) if row else None

    def list_account_rows(self) -> list[dict[str, Any]]:
        return [self._account_row(r) for r in self.db.execute("SELECT * FROM fanqie_accounts ORDER BY created_at")]

    def account_cookies(self, account_id: str) -> list[dict[str, Any]]:
        account = self.get_account(account_id)
        if not account:
            return []
        parsed = parse_json(account["session"]["cookiesPayload"], None)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and isinstance(parsed.get("cookies"), list):
            return parsed["cookies"]
        return []

    def ensure_account(self, account_id: str, name: str | None = None, aliases: list[str] | None = None) -> dict[str, Any]:
        account_id = str(account_id or "").strip()
        if not account_id:
            raise ServiceError("invalid_account", "accountId is required", 400)
        t = now_iso()
        self.db.execute(
            "INSERT INTO fanqie_accounts (account_id, name, aliases, created_at, updated_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(account_id) DO NOTHING",
            (account_id, name or account_id, json.dumps(aliases or [], ensure_ascii=False), t, t),
        )
        return self.get_account(account_id)  # type: ignore[return-value]

    def record_account_session(
        self,
        account_id: str,
        cookies_payload: dict[str, Any],
        *,
        name: str | None = None,
        aliases: list[str] | None = None,
    ) -> dict[str, Any]:
        self.ensure_account(account_id, name, aliases)
        t = now_iso()
        self.db.execute(
            "UPDATE fanqie_accounts SET name = COALESCE(?, name), aliases = COALESCE(?, aliases), cookies_payload = ?, "
            "cookie_checksum = ?, cookie_count = ?, expires_summary = ?, session_synced_at = ?, updated_at = ? WHERE account_id = ?",
            (
                name,
                json.dumps(aliases, ensure_ascii=False) if aliases is not None else None,
                json.dumps(cookies_payload, ensure_ascii=False),
                cookies_payload.get("checksum"),
                cookies_payload.get("cookieCount"),
                json.dumps(cookies_payload.get("expiresSummary"), ensure_ascii=False),
                t,
                t,
                account_id,
            ),
        )
        return {"accountId": account_id, "syncedAt": t}

    async def list_fanqie_accounts(self) -> list[dict[str, Any]]:
        return [
            {
                "id": row["accountId"],
                "name": row["name"],
                "aliases": row["aliases"],
                "status": "disabled" if row["status"] == "disabled" else "active",
                "cookiesStorageType": "external",
                "meta": {
                    "source": "local",
                    "cookieCount": row["session"]["cookieCount"],
                    "sessionSyncedAt": row["session"]["syncedAt"],
                },
                "createdAt": row["createdAt"],
                "updatedAt": row["updatedAt"],
            }
            for row in self.list_account_rows()
        ]

    # ---- 发布目标 ----

    @staticmethod
    def _target(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "platform": row["platform"],
            "accountIdentity": row["account_identity"],
            "localWorkId": row["local_work_id"],
            "remoteWorkId": row["remote_work_id"],
            "status": row["status"],
            "metadata": parse_json(row["metadata"], {}),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    async def list_publication_targets(self, query: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        query = query or {}
        where, params = [], []
        for column, key in (("platform", "platform"), ("account_identity", "accountIdentity"), ("remote_work_id", "remoteWorkId")):
            if not blank(query.get(key)):
                where.append(f"{column} = ?")
                params.append(str(query[key]))
        if not blank(query.get("localWorkId")):
            where.append("local_work_id = ?")
            params.append(str(query["localWorkId"]))
        sql = "SELECT * FROM publication_targets" + (f" WHERE {' AND '.join(where)}" if where else "") + " ORDER BY created_at LIMIT ?"
        return [self._target(r) for r in self.db.execute(sql, (*params, normalize_limit(query.get("limit"), 100)))]

    def _target_by_id(self, target_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM publication_targets WHERE id = ?", (target_id,)).fetchone()
        return self._target(row) if row else None

    async def register_publication_target(self, data: dict[str, Any]) -> dict[str, Any]:
        account_identity = required(data.get("accountIdentity") or data.get("accountId"), "accountId")
        remote_work_id = data.get("remoteWorkId") or data.get("bookId") or None
        local_work_id = required(data.get("localWorkId"), "localWorkId")
        t = now_iso()
        if data.get("targetId"):
            row = self.db.execute("SELECT * FROM publication_targets WHERE id = ?", (data["targetId"],)).fetchone()
        else:
            row = self.db.execute(
                "SELECT * FROM publication_targets WHERE platform = 'fanqie' AND account_identity = ? AND remote_work_id IS ?",
                (account_identity, remote_work_id),
            ).fetchone()
        metadata = {**(parse_json(row["metadata"], {}) if row else {}), **(data.get("metadata") or {}),
                    "title": data.get("title"), "author": data.get("author")}
        if row:
            self.db.execute(
                "UPDATE publication_targets SET account_identity = ?, local_work_id = ?, remote_work_id = ?, status = ?, "
                "metadata = ?, updated_at = ? WHERE id = ?",
                (account_identity, local_work_id, remote_work_id, data.get("status") or row["status"],
                 json.dumps(metadata, ensure_ascii=False), t, row["id"]),
            )
            return self._target_by_id(row["id"])  # type: ignore[return-value]
        target_id = data.get("targetId") or f"pt_{uuid.uuid4()}"
        self.db.execute(
            "INSERT INTO publication_targets (id, platform, account_identity, local_work_id, remote_work_id, status, metadata, "
            "created_at, updated_at) VALUES (?, 'fanqie', ?, ?, ?, ?, ?, ?, ?)",
            (target_id, account_identity, local_work_id, remote_work_id, data.get("status") or "active",
             json.dumps(metadata, ensure_ascii=False), t, t),
        )
        return self._target_by_id(target_id)  # type: ignore[return-value]

    # ---- 远端快照 ----

    async def list_fanqie_works(self, query: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        query = query or {}
        where, params = [], []
        if not blank(query.get("accountId")):
            where.append("account_id = ?")
            params.append(query["accountId"])
        if not blank(query.get("search")):
            where.append("(title LIKE ? OR work_id = ?)")
            params.extend([f"%{query['search']}%", query["search"]])
        sql = "SELECT * FROM fanqie_works" + (f" WHERE {' AND '.join(where)}" if where else "") + " ORDER BY scanned_at DESC LIMIT ?"
        return [
            {
                "id": r["id"], "account_id": r["account_id"], "work_id": r["work_id"], "book_id": r["work_id"],
                "title": r["title"], "chapter_count": r["chapter_count"], "latest_chapter_number": r["latest_chapter_number"],
                "scanned_at": r["scanned_at"], "raw": parse_json(r["raw"], None),
            }
            for r in self.db.execute(sql, (*params, normalize_limit(query.get("limit"), 100)))
        ]

    async def sync_fanqie_works(self, works: Iterable[dict[str, Any]]) -> dict[str, Any]:
        synced_at = now_iso()
        result = []
        self.db.execute("BEGIN")
        try:
            for work in works:
                existing = self.db.execute(
                    "SELECT id FROM fanqie_works WHERE account_id = ? AND work_id = ?", (work["accountId"], work["bookId"])
                ).fetchone()
                self.db.execute(
                    "INSERT INTO fanqie_works (account_id, work_id, title, chapter_count, latest_chapter_number, raw, scanned_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, work_id) DO UPDATE SET title = excluded.title, "
                    "chapter_count = excluded.chapter_count, latest_chapter_number = excluded.latest_chapter_number, "
                    "raw = excluded.raw, scanned_at = excluded.scanned_at",
                    (work["accountId"], work["bookId"], work.get("title"), work.get("chapterCount"), work.get("latestChapterNumber"),
                     json.dumps(work.get("raw"), ensure_ascii=False) if work.get("raw") else None, work.get("scannedAt") or synced_at),
                )
                row = self.db.execute(
                    "SELECT id FROM fanqie_works WHERE account_id = ? AND work_id = ?", (work["accountId"], work["bookId"])
                ).fetchone()
                result.append({"id": row["id"], "accountId": work["accountId"], "bookId": work["bookId"],
                               "title": work.get("title"), "action": "updated" if existing else "inserted"})
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return {"syncedAt": synced_at, "count": len(result), "works": result}

    async def sync_fanqie_remote_chapters(self, account_id: str, book_id: str, chapters: list[dict[str, Any]]) -> dict[str, Any]:
        synced_at = now_iso()
        self.db.execute("BEGIN")
        try:
            for ch in chapters:
                self.db.execute(
                    "INSERT INTO fanqie_remote_chapters (account_id, book_id, chapter_number, item_id, title, word_count, "
                    "published_at, raw, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(account_id, book_id, chapter_number) DO UPDATE SET item_id = excluded.item_id, "
                    "title = excluded.title, word_count = excluded.word_count, published_at = excluded.published_at, "
                    "raw = excluded.raw, synced_at = excluded.synced_at",
                    (account_id, book_id, ch["chapterNumber"], ch.get("itemId"), ch.get("title"), ch.get("wordCount"),
                     ch.get("publishedAt"), json.dumps(ch.get("raw"), ensure_ascii=False) if ch.get("raw") else None,
                     ch.get("syncedAt") or synced_at),
                )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return {"accountId": account_id, "bookId": book_id, "chapterCount": len(chapters), "syncedAt": synced_at}

    # ---- 发布记录 ----

    async def record_publication_result(self, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("targetId"):
            target = self._target_by_id(data["targetId"])
        else:
            found = await self.list_publication_targets(
                {"platform": "fanqie", "accountIdentity": data["accountId"], "remoteWorkId": data["bookId"], "limit": 1}
            )
            target = found[0] if found else await self.register_publication_target(
                {"accountId": data["accountId"], "bookId": data["bookId"], "localWorkId": data["localWorkId"]}
            )
        if not target:
            raise ServiceError("publication_target_not_found", f"publication target not found: {data.get('targetId')}", 404)
        record_id = f"pr_{uuid.uuid4()}"
        chapter_id = None if blank(data.get("chapterId")) else int(data["chapterId"])
        self.db.execute(
            "INSERT INTO publication_records (id, target_id, local_work_id, chapter_id, chapter_number, action, remote_part_id, "
            "observed_status, published_at, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (record_id, target["id"], str(data["localWorkId"]), chapter_id, data["chapterNumber"], data["action"],
             data.get("remotePartId"), data["observedStatus"], data.get("publishedAt"),
             json.dumps(data.get("result"), ensure_ascii=False, default=str) if data.get("result") else None, now_iso()),
        )
        status = data["observedStatus"]
        return {
            "recordId": record_id, "targetId": target["id"], "contentPartId": data.get("contentPartId"), "chapterId": chapter_id,
            "chapterNumber": data["chapterNumber"], "action": data["action"], "remotePartId": data.get("remotePartId"),
            "observedStatus": status, "chapterStatus": None if status == "failed" else status, "contentPartStatus": None,
        }

    def published_at(self, local_work_id: str, chapter_number: int) -> str | None:
        row = self.db.execute(
            "SELECT COALESCE(published_at, created_at) AS at FROM publication_records WHERE local_work_id = ? AND chapter_number = ? "
            "AND action = 'publish_chapter' AND observed_status IN ('submitted', 'published') ORDER BY created_at DESC LIMIT 1",
            (str(local_work_id), chapter_number),
        ).fetchone()
        return row["at"] if row else None

    # ---- 发布上下文与章节解析 ----

    async def _resolve_target_query(self, query: dict[str, Any]) -> dict[str, Any]:
        if blank(query.get("targetId")):
            return query
        target = self._target_by_id(str(query["targetId"]))
        if not target:
            raise ServiceError("publication_target_not_found", f"publication target not found: {query['targetId']}", 404)
        if target["status"] != "active":
            raise ServiceError("publication_target_inactive", f"publication target is not active: {query['targetId']}", 422, target)
        return {
            **query,
            "accountId": target["accountIdentity"] if blank(query.get("accountId")) else query["accountId"],
            "bookId": required(target["remoteWorkId"], "bookId") if blank(query.get("bookId")) else query["bookId"],
            "localWorkId": target["localWorkId"] if blank(query.get("localWorkId")) else query["localWorkId"],
        }

    async def get_publish_context(self, query: dict[str, Any] | None = None) -> dict[str, Any]:
        query = query or {}
        resolved = await self._resolve_target_query(query)
        limit = normalize_limit(query.get("limit"), 200)
        targets = await self.list_publication_targets(
            {"platform": "fanqie", "accountIdentity": resolved.get("accountId"), "localWorkId": resolved.get("localWorkId"), "limit": limit}
        )
        book_id = resolved.get("bookId")
        matched = next((t for t in targets if blank(book_id) or t["remoteWorkId"] == str(book_id)), None)
        works = await self.list_fanqie_works({"accountId": resolved.get("accountId"), "limit": limit})
        book_id = book_id if not blank(book_id) else (matched or {}).get("remoteWorkId")
        local_work_id = resolved.get("localWorkId")
        return {
            "accountId": resolved.get("accountId") or (matched or {}).get("accountIdentity"),
            "bookId": book_id,
            "localWorkId": str(local_work_id) if not blank(local_work_id) else (matched or {}).get("localWorkId"),
            "publicationTargets": targets,
            "fanqieWorks": works,
            "matchedTarget": matched,
            "matchedFanqieWork": next((w for w in works if str(w["work_id"]) == str(book_id)), None),
        }

    async def resolve_publish_chapter(self, data: dict[str, Any]) -> dict[str, Any]:
        context = await self.get_publish_context({
            "accountId": data.get("accountId"), "bookId": data.get("bookId"),
            "localWorkId": data.get("localWorkId"), "targetId": data.get("targetId"), "limit": 200,
        })
        account_id = required(context.get("accountId") or data.get("accountId"), "accountId")
        book_id = required(context.get("bookId") or data.get("bookId"), "bookId")
        local_work_id = required(context.get("localWorkId") or data.get("localWorkId"), "localWorkId")
        chapters = self.chapters.list_chapters(local_work_id)
        if not blank(data.get("chapterId")):
            chapter = next((c for c in chapters if c["id"] == str(data["chapterId"])), None)
        elif data.get("chapterNumber") is not None:
            chapter = next((c for c in chapters if c["chapterNumber"] == int(data["chapterNumber"])), None)
        else:
            chapter = next((c for c in chapters if not self.published_at(local_work_id, c["chapterNumber"])), None)
        if not chapter:
            raise ServiceError("chapter_not_found", f"作品 {local_work_id} 中找不到要发布的章节", 404, {
                "chapterId": data.get("chapterId"), "chapterNumber": data.get("chapterNumber"), "chapterCount": len(chapters),
            })
        chapter = {**chapter, "publishedAt": self.published_at(local_work_id, chapter["chapterNumber"])}
        publish_input = {
            "accountId": account_id, "bookId": book_id, "chapterNumber": chapter["chapterNumber"],
            "title": chapter["title"], "content": chapter["content"],
            "source": {"workId": local_work_id, "chapterId": chapter["id"], "requestId": data.get("requestId")},
        }
        for key in ("idempotencyKey", "headless", "dryRun", "waitForCompletion"):
            if data.get(key) is not None:
                publish_input[key] = data[key]
        return {
            "accountId": account_id, "bookId": book_id, "localWorkId": local_work_id,
            "chapter": chapter, "context": context, "publishInput": publish_input,
        }

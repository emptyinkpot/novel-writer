"""账号、作品和草稿的账号归属对象。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class DraftObject:
    account_id: str
    book_id: str
    item_id: str
    title: str
    chapter_number: int | None = None
    word_count: int = 0
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DraftObject:
        return cls(
            account_id=str(data.get("accountId") or data.get("account_id") or ""),
            book_id=str(data.get("bookId") or data.get("book_id") or ""),
            item_id=str(data.get("itemId") or data.get("item_id") or ""),
            title=str(data.get("title") or ""),
            chapter_number=data.get("chapterNumber", data.get("chapter_number")),
            word_count=int(data.get("wordCount", data.get("word_count")) or 0),
            updated_at=data.get("updatedAt", data.get("updated_at")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "accountId": self.account_id,
            "bookId": self.book_id,
            "itemId": self.item_id,
            "title": self.title,
            "chapterNumber": self.chapter_number,
            "wordCount": self.word_count,
            "updatedAt": self.updated_at,
        }


@dataclass(slots=True)
class WorkObject:
    account_id: str
    book_id: str
    title: str
    status: str | None = None
    chapter_count: int | None = None
    latest_chapter_number: int | None = None
    scanned_at: str | None = None
    draft_scan_status: str = "not_scanned"
    draft_scanned_at: str | None = None
    draft_scan_error: str | None = None
    chapter_manage_url: str | None = None
    drafts: list[DraftObject] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkObject:
        return cls(
            account_id=str(data.get("accountId") or data.get("account_id") or ""),
            book_id=str(data.get("bookId") or data.get("book_id") or ""),
            title=str(data.get("title") or ""),
            status=data.get("status"),
            chapter_count=data.get("chapterCount", data.get("chapter_count")),
            latest_chapter_number=data.get("latestChapterNumber", data.get("latest_chapter_number")),
            scanned_at=data.get("scannedAt", data.get("scanned_at")),
            draft_scan_status=str(data.get("draftScanStatus", data.get("draft_scan_status", "not_scanned"))),
            draft_scanned_at=data.get("draftScannedAt", data.get("draft_scanned_at")),
            draft_scan_error=data.get("draftScanError", data.get("draft_scan_error")),
            chapter_manage_url=data.get("chapterManageUrl", data.get("chapter_manage_url")),
            drafts=[DraftObject.from_dict(item) for item in data.get("drafts", [])],
        )

    @property
    def draft_count(self) -> int:
        return len(self.drafts)

    def get_draft(self, item_id: str) -> DraftObject | None:
        return next((draft for draft in self.drafts if draft.item_id == str(item_id)), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "accountId": self.account_id,
            "bookId": self.book_id,
            "title": self.title,
            "status": self.status,
            "chapterCount": self.chapter_count,
            "latestChapterNumber": self.latest_chapter_number,
            "scannedAt": self.scanned_at,
            "draftScanStatus": self.draft_scan_status,
            "draftScannedAt": self.draft_scanned_at,
            "draftScanError": self.draft_scan_error,
            "chapterManageUrl": self.chapter_manage_url,
            "draftCount": self.draft_count,
            "drafts": [draft.to_dict() for draft in self.drafts],
        }


@dataclass(slots=True)
class AccountObject:
    account_id: str
    name: str
    scanned_at: str | None = None
    scan_status: str = "not_scanned"
    scan_errors: list[dict[str, str]] = field(default_factory=list)
    works: list[WorkObject] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AccountObject:
        return cls(
            account_id=str(data.get("accountId") or data.get("account_id") or data.get("id") or ""),
            name=str(data.get("name") or data.get("accountId") or data.get("account_id") or data.get("id") or ""),
            scanned_at=data.get("scannedAt", data.get("scanned_at")),
            scan_status=str(data.get("scanStatus", data.get("scan_status", "not_scanned"))),
            scan_errors=list(data.get("scanErrors", data.get("scan_errors", [])) or []),
            works=[WorkObject.from_dict(item) for item in data.get("works", [])],
        )

    def get_work(self, book_id: str) -> WorkObject | None:
        return next((work for work in self.works if work.book_id == str(book_id)), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "accountId": self.account_id,
            "name": self.name,
            "scannedAt": self.scanned_at,
            "scanStatus": self.scan_status,
            "scanErrors": self.scan_errors,
            "workCount": len(self.works),
            "works": [work.to_dict() for work in self.works],
        }

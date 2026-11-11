"""番茄公开页面读取：搜书、作品详情与目录、章节正文、书评，以及导出 TXT。不需要登录。"""
from __future__ import annotations

import json
import re
from urllib.parse import quote
from datetime import datetime, timezone
from typing import Any

import httpx
from playwright.async_api import async_playwright

from .browser import resolve_browser_executable
from .errors import ServiceError
from .reader_font import FONT_MAP

ORIGIN = "https://fanqienovel.com"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/127.0.0.0 Safari/537.36")

JS_SEARCH_RESULTS = """(limit) => {
  const text = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const seen = new Set();
  const output = [];
  for (const anchor of Array.from(document.querySelectorAll('a[href*="/page/"]'))) {
    const href = anchor.getAttribute('href') || '';
    const match = href.match(/\\/page\\/(\\d+)/);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    const card = anchor.closest('li, article, [class*="book"], [class*="search"]') || anchor.parentElement;
    output.push({
      bookId: match[1],
      title: text(anchor),
      author: text(card?.querySelector('[class*="author"]')) || undefined,
      description: text(card?.querySelector('[class*="desc"], [class*="intro"], p')) || undefined,
      coverUrl: card?.querySelector('img')?.src || undefined,
      pageUrl: href.startsWith('http') ? href : `https://fanqienovel.com${href}`,
    });
    if (output.length >= limit) break;
  }
  return output;
}"""


def _number(value: Any) -> float | int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


def _bool(value: Any) -> bool | None:
    return None if value is None else bool(value)


def extract_book_id(value: str) -> str | None:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{10,}", text):
        return text
    match = re.search(r"/page/(\d+)", text)
    return match.group(1) if match else None


def extract_item_id(value: str) -> str | None:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{10,}", text):
        return text
    match = re.search(r"/reader/(\d+)", text)
    return match.group(1) if match else None


def decode_text(text: str) -> str:
    return "".join(FONT_MAP.get(ord(ch), ch) for ch in text)


def html_to_text(value: str) -> str:
    text = re.sub(r"<p>", "", value, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_initial_state(page_html: str) -> dict[str, Any] | None:
    match = re.search(r"window\.__INITIAL_STATE__=(\{[\s\S]*?\});", page_html)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except ValueError:
        return None


def flatten_chapters(source: list[Any]) -> list[dict[str, Any]]:
    chapters = []
    for entry in source or []:
        volume = str((entry or {}).get("volume_name") or (entry or {}).get("volumeName") or "") if isinstance(entry, dict) else ""
        items = entry.get("chapterList") if isinstance(entry, dict) and isinstance(entry.get("chapterList"), list) else (
            entry if isinstance(entry, list) else [])
        for chapter in items:
            item_id = str((chapter or {}).get("itemId") or "")
            if not item_id:
                continue
            chapters.append({"itemId": item_id, "title": str(chapter.get("title") or ""),
                             "chapterNumber": _number(chapter.get("realChapterOrder") or chapter.get("chapterNumber")),
                             "volumeName": volume or None, "isLocked": _bool(chapter.get("isChapterLock"))})
    return chapters


class FanqieReader:
    async def _fetch_html(self, url: str) -> str:
        async with httpx.AsyncClient(timeout=30, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
                                     follow_redirects=True) as client:
            response = await client.get(url)
        if response.status_code >= 400:
            raise ServiceError("reader_http_failed", f"fetch html failed: {response.status_code}", response.status_code, {"url": url})
        return response.text

    async def search_books(self, query: str, limit: int | None = None) -> list[dict[str, Any]]:
        query = str(query or "").strip()
        if not query:
            raise ServiceError("reader_search_invalid", "query is required", 400)
        book_id = extract_book_id(query)
        if book_id:
            detail = await self.get_book_detail(book_id)
            return [{k: detail.get(k) for k in ("bookId", "title", "author", "description", "coverUrl", "pageUrl")}]
        limit = min(max(int(limit or 10), 1), 20)
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, executable_path=resolve_browser_executable())
            try:
                page = await browser.new_page(user_agent=USER_AGENT, viewport={"width": 1440, "height": 1200})
                await page.goto(f"{ORIGIN}/search/{quote(query)}",
                                wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(5000)
                return await page.evaluate(JS_SEARCH_RESULTS, limit)
            finally:
                await browser.close()

    async def get_book_detail(self, book_id_or_url: str) -> dict[str, Any]:
        book_id = extract_book_id(book_id_or_url)
        if not book_id:
            raise ServiceError("reader_book_invalid", "bookId is required", 400)
        state = parse_initial_state(await self._fetch_html(f"{ORIGIN}/page/{book_id}")) or {}
        page = state.get("page") or {}
        if not page or not page.get("hasFetch"):
            raise ServiceError("reader_book_not_found", f"book detail not found: {book_id}", 404)
        status_number, creation = _number(page.get("status")), _number(page.get("creationStatus"))
        status = "已完结" if 2 in (status_number, creation) else "连载中" if 1 in (status_number, creation) else None
        return {
            "bookId": str(page.get("bookId") or book_id), "title": str(page.get("bookName") or ""),
            "author": str(page.get("author") or ""), "description": page.get("description") or None,
            "coverUrl": page.get("thumbUrl") or page.get("thumbUri") or None, "pageUrl": f"{ORIGIN}/page/{book_id}",
            "category": page.get("category") or page.get("categoryV2") or None, "status": status,
            "wordCount": _number(page.get("wordNumber")), "chapterTotal": _number(page.get("chapterTotal")),
            "lastChapterItemId": page.get("lastChapterItemId") or None, "lastChapterTitle": page.get("lastChapterTitle") or None,
            "abstract": page.get("abstract") or None,
            "chapters": flatten_chapters(page.get("chapterListWithVolume") or page.get("chapterList") or []),
        }

    async def get_chapter_detail(self, item_id_or_url: str) -> dict[str, Any]:
        item_id = extract_item_id(item_id_or_url)
        if not item_id:
            raise ServiceError("reader_chapter_invalid", "itemId is required", 400)
        page_html = await self._fetch_html(f"{ORIGIN}/reader/{item_id}")
        data = ((parse_initial_state(page_html) or {}).get("reader") or {}).get("chapterData") or {}
        raw = str(data.get("content") or "")
        if not raw:
            raise ServiceError("reader_chapter_not_found", f"chapter detail not found: {item_id}", 404)
        article = re.search(r"<article>([\s\S]*?)</article>", raw, re.I)
        content_html = article.group(1) if article else raw
        updated = re.search(r'<span class="title">更新时间：</span>([^<]+)<', page_html)
        return {
            "itemId": str(data.get("itemId") or item_id), "bookId": str(data.get("bookId") or ""), "title": str(data.get("title") or ""),
            "bookTitle": data.get("bookName") or None, "author": data.get("author") or None, "contentHtml": content_html,
            "contentText": decode_text(html_to_text(content_html)), "wordCount": _number(data.get("chapterWordNumber")),
            "prevItemId": data.get("preItemId") or None, "nextItemId": data.get("nextItemId") or None,
            "updatedAtText": updated.group(1).strip() if updated else None, "isLocked": _bool(data.get("isChapterLock")),
        }

    async def get_book_comments(self, book_id_or_url: str, limit: int = 30) -> dict[str, Any]:
        book_id = extract_book_id(book_id_or_url)
        if not book_id:
            raise ServiceError("reader_book_invalid", "bookId is required", 400)
        state = parse_initial_state(await self._fetch_html(f"{ORIGIN}/page/{book_id}")) or {}
        page = state.get("page") or {}
        source = page.get("commentList") or (page.get("bookComment") or {}).get("list") or (state.get("comment") or {}).get("list") or []
        comments = []
        for item in source if isinstance(source, list) else []:
            info, user = item.get("info") or {}, item.get("user") or {}
            content = str(info.get("text") or item.get("content") or item.get("text") or "")
            if len(content) < 2:
                continue
            created = info.get("create_time")
            comments.append({
                "username": str(user.get("nick_name") or user.get("name") or item.get("userName") or "匿名"),
                "content": content, "likes": int(info.get("digg_count") or item.get("likeCount") or 0),
                "timestamp": datetime.fromtimestamp(int(created), tz=timezone.utc).isoformat() if created else None,
            })
            if len(comments) >= limit:
                break
        return {"bookId": book_id, "comments": comments, "total": len(comments)}

    # ---- 导出 ----

    @staticmethod
    def _sanitize_filename(value: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|]', "_", value)).strip()

    @staticmethod
    def _render_chapter(detail: dict[str, Any], include_meta: bool) -> str:
        if not include_meta:
            return detail["contentText"].strip()
        lines = [detail.get("bookTitle") or detail.get("bookId"), f"作者：{detail['author']}" if detail.get("author") else None,
                 detail["title"], f"更新时间：{detail['updatedAtText']}" if detail.get("updatedAtText") else None, "",
                 detail["contentText"].strip()]
        return "\n".join(line for line in lines if line is not None)

    async def export_chapter_text(self, item_id: str, include_meta: bool = True) -> dict[str, Any]:
        detail = await self.get_chapter_detail(item_id)
        return {
            "format": "txt",
            "filename": self._sanitize_filename(f"{detail.get('bookTitle') or detail['bookId']}-{detail['title']}-{detail['itemId']}.txt"),
            "itemId": detail["itemId"], "bookId": detail["bookId"], "title": detail["title"], "bookTitle": detail.get("bookTitle"),
            "author": detail.get("author"), "wordCount": detail.get("wordCount"), "content": self._render_chapter(detail, include_meta),
        }

    async def export_book_text(self, book_id: str, item_ids: list[str] | None = None, include_meta: bool = True) -> dict[str, Any]:
        detail = await self.get_book_detail(book_id)
        allowed = {str(i).strip() for i in item_ids or [] if str(i).strip()}
        outlines = [c for c in detail["chapters"] if not allowed or c["itemId"] in allowed]
        if not outlines:
            raise ServiceError("reader_book_export_empty", "no chapters matched export input", 404)
        chapters, skipped, sections = [], [], []
        for outline in outlines:
            try:
                chapter = await self.get_chapter_detail(outline["itemId"])
            except Exception as error:  # noqa: BLE001
                skipped.append({"itemId": outline["itemId"], "title": outline["title"], "error": str(error)})
                continue
            chapters.append({"itemId": chapter["itemId"], "title": chapter["title"], "chapterNumber": outline.get("chapterNumber"),
                             "wordCount": chapter.get("wordCount")})
            sections.append(self._render_chapter(chapter, include_meta))
        if not chapters:
            raise ServiceError("reader_book_export_failed", "all chapter exports failed", 502, {"skippedChapters": skipped})
        parts = []
        if include_meta:
            parts.append("\n".join(x for x in [
                detail["title"], f"作者：{detail['author']}" if detail.get("author") else None,
                f"分类：{detail['category']}" if detail.get("category") else None, f"状态：{detail['status']}" if detail.get("status") else None,
                f"章节数：{detail['chapterTotal']}" if detail.get("chapterTotal") is not None else None,
                f"简介：{detail['abstract']}" if detail.get("abstract") else None] if x))
        parts.extend(sections)
        return {
            "format": "txt", "filename": self._sanitize_filename(f"{detail['title']}-{detail['bookId']}.txt"), "bookId": detail["bookId"],
            "title": detail["title"], "author": detail.get("author"), "chapterCount": len(outlines), "exportedChapterCount": len(chapters),
            "skippedChapters": skipped, "chapters": chapters, "content": "\n\n".join(parts),
        }

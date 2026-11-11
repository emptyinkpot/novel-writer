"""番茄作者后台的页面操作：作品列表、章节列表、发布新章节、读取/修改已发布章节。

选择器和交互顺序针对番茄后台当前页面结构；页面改版时只需要改这个文件。
"""
from __future__ import annotations

import asyncio
import html
import json
import re
import time
from pathlib import Path
from typing import Any

from playwright.async_api import Page
from playwright.async_api import TimeoutError as PlaywrightTimeout

from .browser import BOOK_MANAGE_URL, WORK_ITEM_SELECTOR, sanitize_file_part
from .errors import driver_failed

CHAPTER_PREFIX = re.compile(r"^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s*")
NEXT_PAGE_SELECTOR = '.arco-pagination-next, .arco-pagination-item-next, button[aria-label="下一页"], button:has-text("下一页"), a:has-text("下一页")'

# ---------------------------------------------------------------------------
# 文本工具
# ---------------------------------------------------------------------------


def normalize_text(value: Any) -> str:
    return str(value or "").replace("\r\n", "\n").replace(" ", " ").strip()


def normalize_chapter_title(value: Any) -> str:
    return CHAPTER_PREFIX.sub("", normalize_text(value)).strip()


def html_to_plain_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(text)).strip()


def clean_content(content: str) -> str:
    """清理从上游编辑器/AI 工具漏进正文的控制文字和定位噪声。"""
    cleaned = normalize_text(content)
    for pattern in (r"arrivedat\w+\.?\s*", r"location:\s*\w+\.?\s*", r"「「([^」]+)」\d+」", r"」\d+」"):
        cleaned = re.sub(pattern, "", cleaned, flags=re.I)
    junk = ("章节概要", "总结当前章节概要", "批量生成概要", "处理配置", "已启用", "AI 模型")
    lines = []
    for line in cleaned.split("\n"):
        stripped = line.strip()
        if stripped and any(item in stripped for item in junk):
            continue
        if stripped and re.fullmatch(r"[a-zA-Z\s,.'\"]+", stripped) and len(stripped) > 5:
            continue
        lines.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


# ---------------------------------------------------------------------------
# 页面内脚本（）
# ---------------------------------------------------------------------------

JS_LIST_WORKS = """() => Array.from(document.querySelectorAll('[id^="long-article-table-item-"]')).map((item) => {
  const id = item.id.replace('long-article-table-item-', '');
  const title = item.querySelector('.hoverup')?.textContent?.split('\\n')[0]?.trim() || '';
  const text = item.textContent || '';
  const links = Array.from(item.querySelectorAll('a'));
  const latestLabel = links.map((el) => el.textContent?.trim() || '').find((v) => /^第.+章/.test(v)) || '';
  const latestChapterNumber = Number.parseInt((latestLabel.match(/第\\s*(\\d+)\\s*章/) || [])[1] || '0', 10) || 0;
  const chapterManageUrl = links.map((el) => el.href || '').find((h) => h.includes('/chapter-manage/')) || '';
  const createChapterUrl = links.map((el) => el.href || '').find((h) => h.includes('/publish/')) || '';
  let status = '连载中';
  if (text.includes('已签约')) status = '已签约';
  else if (text.includes('已完结')) status = '已完结';
  else if (text.includes('停止推荐')) status = '已停止推荐';
  else if (text.includes('待审核')) status = '待审核';
  const chapterCount = Number.parseInt((text.match(/(\\d+)\\s*章/) || [])[1] || '0', 10) || 0;
  return { id, title, status, chapterCount, latestChapterLabel: latestLabel, latestChapterNumber, chapterManageUrl, createChapterUrl };
}).filter((item) => item.id && item.title)"""

JS_CHAPTER_ROWS = """() => Array.from(document.querySelectorAll('table tbody tr')).map((row, index) => {
  const cells = Array.from(row.querySelectorAll('td'));
  const previewLink = row.querySelector('a[href*="/preview/"]');
  const editLink = row.querySelector('a[href*="/publish/"]');
  const title = cells[0]?.textContent?.trim() || previewLink?.textContent?.trim() || '';
  const itemId = (editLink?.getAttribute('href')?.match(/\\/publish\\/([^/?]+)\\//) || previewLink?.getAttribute('href')?.match(/&([^&/?]+)$/) || [])[1] || '';
  const chapterNumber = Number.parseInt((title.match(/第\\s*(\\d+)\\s*章/) || [])[1] || '0', 10) || 0;
  return {
    itemId, title, chapterNumber, listIndex: index + 1,
    wordCount: Number.parseInt(cells[1]?.textContent?.trim() || '0', 10) || 0,
    status: cells[3]?.textContent?.trim() || '',
    publishedAt: cells[4]?.textContent?.trim() || '',
    previewUrl: previewLink?.href || '',
    editUrl: editLink?.href || '',
  };
}).filter((item) => item.itemId && item.title)"""

JS_SCROLL_TABLE = """() => {
  [document.querySelector('.arco-table-body'), document.querySelector('.arco-table-body-inner'),
   document.querySelector('.arco-table-container'), document.scrollingElement || document.documentElement || document.body]
    .filter(Boolean).forEach((t) => { t.scrollTop = t.scrollHeight; });
}"""

JS_CLOSE_POPUPS = """() => {
  for (const el of Array.from(document.querySelectorAll('[class*="close"], [aria-label*="close"]'))) {
    if (el instanceof HTMLElement) el.click();
  }
  const texts = ['知道了', '我知道了', 'Accept', '确定', '关闭'];
  for (const b of Array.from(document.querySelectorAll('button'))) {
    if (texts.some((t) => b.textContent?.includes(t)) && b instanceof HTMLElement) b.click();
  }
}"""

JS_FILL_CHAPTER_NUMBER = """(value) => {
  const inputs = Array.from(document.querySelectorAll('input')).filter((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const text = `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.className || ''}`.toLowerCase();
    if (text.includes('title') || text.includes('标题') || text.includes('chapter-title')) return false;
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled && !el.readOnly;
  });
  const exact = inputs.find((el) => String(el.className || '').includes('serial-input'))
    || inputs.find((el) => el.type === 'number' || el.inputMode === 'numeric') || inputs[0];
  if (!exact) return false;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(exact), 'value');
  if (descriptor?.set) descriptor.set.call(exact, String(value)); else exact.value = String(value);
  exact.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
  exact.dispatchEvent(new Event('change', { bubbles: true }));
  exact.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}"""

JS_DESCRIBE_INPUTS = """() => Array.from(document.querySelectorAll('input')).map((el, index) => {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const formItem = el.closest('.arco-form-item, .byte-form-item, .form-item');
  const labelText = formItem?.querySelector('label, .arco-form-item-label, .byte-form-item-label')?.textContent?.trim() || '';
  return {
    index, type: el.type, inputMode: el.inputMode || '', placeholder: el.placeholder || '', name: el.name || '', id: el.id || '', labelText,
    visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      && el.getAttribute('aria-hidden') !== 'true' && !el.disabled && !el.readOnly,
  };
})"""

JS_PASTE_CONTENT = """(text) => {
  const clip = new DataTransfer();
  clip.setData('text/plain', text);
  const el = document.querySelector('.ProseMirror, [contenteditable="true"], .editor-content');
  if (el) el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clip, bubbles: true, cancelable: true }));
}"""

JS_EDITOR_LENGTH = """() => {
  const editor = document.querySelector('.ProseMirror, [contenteditable="true"], .editor-content');
  return (editor?.textContent || '').replace(/\\s+/g, '').length;
}"""

JS_SAVE_STATE = """() => {
  const text = document.body?.textContent || '';
  if (text.includes('已保存') || text.includes('保存成功')) return 'saved';
  return document.querySelector('[class*="saving"], [class*="Saving"]') ? 'saving' : 'idle';
}"""

JS_DETECTION_CHOICE = """() => {
  const visible = (el) => { const s = window.getComputedStyle(el); return el.offsetParent !== null && s.visibility !== 'hidden' && s.display !== 'none'; };
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .arco-modal, div[class*="modal"]')).filter(visible);
  const dialog = dialogs.find((el) => (el.textContent || '').includes('请选择内容检测方式'));
  if (!dialog) return false;
  const buttons = Array.from(dialog.querySelectorAll('button'));
  const button = buttons.find((el) => { const t = (el.textContent || '').trim(); return t === '仅基础检测' || t === '基础检测'; })
    || buttons.find((el) => (el.textContent || '').includes('全面检测'));
  if (!button || button.disabled) return false;
  button.click();
  return true;
}"""

JS_CHOOSE_NO_AI = """() => {
  const visible = (el) => { const s = window.getComputedStyle(el); return el.offsetParent !== null && s.visibility !== 'hidden' && s.display !== 'none'; };
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .arco-modal, div[class*="modal"]')).filter(visible);
  const dialog = dialogs.find((el) => (el.textContent || '').includes('发布设置')) || dialogs[0];
  if (!dialog) return false;
  const labels = Array.from(dialog.querySelectorAll('label'));
  const no = labels.find((el) => (el.textContent || '').trim() === '否') || labels.find((el) => (el.textContent || '').includes('否'));
  if (no) { no.click(); return true; }
  const radio = Array.from(dialog.querySelectorAll('input[type="radio"]')).at(-1);
  if (radio) { radio.click(); radio.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  return false;
}"""

JS_DISMISS_DETECTION = """() => {
  const gotIt = Array.from(document.querySelectorAll('button, a, span, div'))
    .find((b) => /^(知道了|我知道了)$/.test(b.textContent?.trim()) && b.offsetParent !== null);
  if (gotIt) gotIt.click();
}"""

JS_CLICK_MODAL_BUTTON = """({ modalSelector, buttonText }) => {
  const modal = Array.from(document.querySelectorAll(modalSelector))
    .find((el) => el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null);
  if (!modal) return false;
  const button = Array.from(modal.querySelectorAll('button')).find((el) => (el.textContent || '').trim() === buttonText);
  if (!button) return false;
  button.click();
  return true;
}"""

JS_REMOVE_HIDDEN_MODALS = """() => {
  for (const s of ['.byte-modal-wrapper[aria-hidden="true"]', '.arco-modal[aria-hidden="true"]', '.arco-modal-wrapper[aria-hidden="true"]']) {
    for (const el of document.querySelectorAll(s)) el.remove();
  }
}"""

JS_DEBUG_STATE = """() => ({
  url: location.href,
  title: document.title,
  buttons: Array.from(document.querySelectorAll('button, a')).map((item) => ({
    text: (item.textContent || '').trim(), tag: item.tagName, className: String(item.className || ''),
    disabled: Boolean(item.disabled), visible: Boolean(item.offsetParent),
  })).filter((item) => item.text),
  bodyPreview: (document.body?.innerText || '').slice(0, 2000),
})"""

JS_EDITOR_DETAIL = """() => {
  const numberInput = Array.from(document.querySelectorAll('input')).find((el) => (el.className || '').includes('serial-input') && String(el.value || '').trim());
  const titleInput = document.querySelector('input[placeholder="请输入标题"]');
  const editor = document.querySelector('.ProseMirror');
  return {
    chapterNumber: Number.parseInt(numberInput?.value || '0', 10) || 0,
    title: titleInput?.value || '',
    contentHtml: editor?.innerHTML || '',
    contentText: editor?.textContent || '',
    wordCount: (editor?.textContent || '').length,
  };
}"""


# ---------------------------------------------------------------------------
# 页面动作
# ---------------------------------------------------------------------------


async def _safe(coro, default=None):
    try:
        return await coro
    except Exception:  # noqa: BLE001 - 页面探测类操作失败时按默认值处理
        return default


async def close_popups(page: Page) -> None:
    await _safe(page.evaluate(JS_CLOSE_POPUPS))


async def goto_book_manage(page: Page) -> None:
    await page.goto(BOOK_MANAGE_URL, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_selector(WORK_ITEM_SELECTOR, state="visible", timeout=30000)
    await page.wait_for_timeout(1200)
    await close_popups(page)


async def list_works(page: Page) -> list[dict[str, Any]]:
    """读取当前账号的作品列表。bookId 来自 DOM id，是发布用的远端作品身份。"""
    await goto_book_manage(page)
    return await page.evaluate(JS_LIST_WORKS)


async def _find_work(page: Page, book_id: str) -> dict[str, Any]:
    works = await list_works(page)
    work = next((w for w in works if w["id"] == str(book_id)), None)
    if not work:
        raise driver_failed(f"未找到作品: {book_id}")
    return work


async def list_remote_chapters(page: Page, book_id: str) -> list[dict[str, Any]]:
    """分页读取远端章节；每页先滚动到底，适配懒加载列表。"""
    work = await _find_work(page, book_id)
    if not work.get("chapterManageUrl"):
        raise driver_failed(f"未找到作品或章节管理链接: {book_id}")
    await page.goto(work["chapterManageUrl"], wait_until="domcontentloaded", timeout=60000)
    await _safe(page.wait_for_selector("table tbody tr", state="visible", timeout=30000))
    await page.wait_for_timeout(1200)
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()
    last_total = 0
    for _ in range(50):
        stable_rounds = 0
        while stable_rounds < 3:
            before = len(collected)
            for row in await page.evaluate(JS_CHAPTER_ROWS):
                if row["itemId"] not in seen:
                    seen.add(row["itemId"])
                    collected.append(row)
            stable_rounds = stable_rounds + 1 if len(collected) == before else 0
            await _safe(page.evaluate(JS_SCROLL_TABLE))
            await page.wait_for_timeout(900)
        if len(collected) <= last_total:
            break
        last_total = len(collected)
        next_button = page.locator(NEXT_PAGE_SELECTOR).first
        if not await _safe(next_button.is_visible(), False):
            break
        class_name = await _safe(next_button.get_attribute("class"), "") or ""
        aria_disabled = await _safe(next_button.get_attribute("aria-disabled"), "") or ""
        if aria_disabled == "true" or re.search(r"disabled", class_name, re.I) or not await _safe(next_button.is_enabled(), False):
            break
        await _safe(next_button.click())
        await page.wait_for_timeout(1200)
        await _safe(page.wait_for_selector("table tbody tr", state="visible", timeout=20000))
    return collected


async def _open_create_chapter_page(page: Page, book_id: str) -> dict[str, Any]:
    """打开指定 bookId 的新建章节页。后台看不到这个精确作品就直接失败，不按书名猜。"""
    work = await _find_work(page, book_id)
    if work.get("createChapterUrl"):
        await page.goto(work["createChapterUrl"], wait_until="domcontentloaded", timeout=60000)
    elif work.get("chapterManageUrl"):
        await page.goto(work["chapterManageUrl"], wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(1000)
        href = await page.evaluate(
            """() => (Array.from(document.querySelectorAll('a')).find((a) => /^(新建章节|创建章节)$/.test(a.textContent?.trim()))?.getAttribute('href') || '')"""
        )
        if href:
            await page.goto(href if href.startswith("http") else f"https://fanqienovel.com{href}", wait_until="domcontentloaded", timeout=60000)
        else:
            await page.locator("a, button").filter(has_text=re.compile(r"^新建章节$")).first.click(timeout=10000)
    else:
        raise driver_failed(f"作品缺少新建章节入口: {book_id}")
    await _safe(page.wait_for_selector('input[type="text"], input[type="number"], [contenteditable="true"], textarea, .ProseMirror',
                                       state="visible", timeout=30000))
    await page.wait_for_timeout(1000)
    await close_popups(page)
    return work


async def _fill_chapter_number(page: Page, chapter_number: int) -> None:
    if await _safe(page.evaluate(JS_FILL_CHAPTER_NUMBER, str(chapter_number)), False):
        await page.wait_for_timeout(500)
        body = await _safe(page.locator("body").inner_text(), "") or ""
        if str(chapter_number) in body:
            return
    inputs = [i for i in await page.evaluate(JS_DESCRIBE_INPUTS) if i["visible"]]
    title_re = re.compile(r"标题|章节名|title|请输入标题")
    for item in inputs:
        combined = f"{item['placeholder']} {item['name']} {item['id']} {item['labelText']}".lower()
        if title_re.search(combined):
            continue
        if item["type"] == "number" or item["inputMode"] == "numeric" or re.search(r"章节号|章节数|章序号|序号|chapter|number|第几章", combined):
            await page.locator("input").nth(item["index"]).fill(str(chapter_number))
            return
    for selector in ('input[placeholder*="章节号"]', 'input[placeholder*="章节数"]', 'input[placeholder*="第"]',
                     'input[name*="chapter"]', 'input[name*="number"]'):
        locator = page.locator(selector).first
        if await _safe(locator.is_visible(), False):
            await locator.fill(str(chapter_number))
            return
    remaining = [i for i in inputs if not title_re.search(f"{i['placeholder']} {i['name']} {i['id']} {i['labelText']}".lower())]
    if remaining:
        await page.locator("input").nth(remaining[0]["index"]).fill(str(chapter_number))


async def _fill_title(page: Page, title: str) -> None:
    await page.wait_for_timeout(1500)
    for selector in ("input.serial-editor-input-hint-area", 'input[placeholder*="标题"]', 'input[placeholder*="请输入标题"]',
                     'input[placeholder*="章节名"]', 'input[name*="title"]', '[data-e2e="chapter-title-input"] input', ".chapter-title input"):
        locator = page.locator(selector).first
        if await _safe(locator.is_visible(timeout=3000), False):
            await locator.fill(title)
            return
    raise driver_failed("无法找到章节标题输入框")


async def _fill_content(page: Page, content: str) -> None:
    """正文优先用粘贴事件写入（ProseMirror 才会更新内部状态），失败再逐字输入。"""
    for selector in (".ProseMirror", '[contenteditable="true"]', ".editor-content", "textarea", '[data-e2e="chapter-content-editor"]'):
        editor = page.locator(selector).first
        if not await _safe(editor.is_visible(), False):
            continue
        if selector == "textarea":
            await editor.fill(content)
            return
        await _safe(editor.click(force=True))
        await page.wait_for_timeout(300)
        await page.evaluate(JS_PASTE_CONTENT, content)
        await page.wait_for_timeout(1000)
        if await page.evaluate(JS_EDITOR_LENGTH) > 0:
            return
        await _safe(editor.click(force=True))
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Delete")
        await page.keyboard.insert_text(content)
        await page.wait_for_timeout(1000)
        if await page.evaluate(JS_EDITOR_LENGTH) > 0:
            return
    raise driver_failed("无法找到正文编辑器")


async def _wait_for_auto_save(page: Page, timeout_ms: int) -> None:
    deadline = time.monotonic() + timeout_ms / 1000
    stable_since = 0.0
    while time.monotonic() < deadline:
        state = await _safe(page.evaluate(JS_SAVE_STATE), "idle")
        if state == "saved":
            return
        if state == "idle":
            stable_since = stable_since or time.monotonic()
            if time.monotonic() - stable_since >= 0.8:
                return
        else:
            stable_since = 0.0
        await page.wait_for_timeout(250)


async def _click_first_visible(page: Page, patterns: list[str], timeout_ms: int) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        for pattern in patterns:
            button = page.locator("button, a").filter(has_text=re.compile(pattern)).first
            try:
                if await button.count() and await _safe(button.is_visible(timeout=500), False) and await _safe(button.is_enabled(), True):
                    await button.click(timeout=3000, force=True)
                    return True
            except Exception:  # noqa: BLE001
                pass
        await page.wait_for_timeout(300)
    return False


async def _click_modal_button(page: Page, modal_selector: str, text: str) -> bool:
    return bool(await _safe(page.evaluate(JS_CLICK_MODAL_BUTTON, {"modalSelector": modal_selector, "buttonText": text}), False))


async def _dismiss_detection_panel(page: Page) -> None:
    await _safe(page.evaluate(JS_DISMISS_DETECTION))
    await page.wait_for_timeout(500)


async def _submit_publish(page: Page) -> Any:
    """点完发布流程，并等到真正的 publish_article 请求；只点按钮不算发布成功。"""
    captured: dict[str, Any] = {}

    def on_response(response):
        if "/api/author/publish_article/v0/" in response.url and response.request.method == "POST":
            captured["response"] = response

    page.on("response", on_response)
    try:
        deadline = time.monotonic() + 90
        await _dismiss_detection_panel(page)
        await _click_first_visible(page, [r"^下一步$"], 7000)
        await page.wait_for_timeout(2000)
        await _dismiss_detection_panel(page)
        await _click_first_visible(page, [r"^下一步$"], 5000)
        while "response" not in captured and time.monotonic() < deadline:
            if await _safe(page.evaluate(JS_DETECTION_CHOICE), False):
                await page.wait_for_timeout(1200)
                continue
            typo = page.locator(".arco-modal.auto-editor-error-modal.publish-modal-confirm").first
            if await _safe(typo.is_visible(timeout=600), False):
                await _click_modal_button(page, ".arco-modal.auto-editor-error-modal.publish-modal-confirm", "提交")
                await page.wait_for_timeout(800)
                continue
            confirm = page.locator('.arco-modal.publish-confirm-container-new, [role="dialog"], div[class*="modal"]').first
            if await _safe(confirm.is_visible(timeout=600), False):
                await _safe(page.evaluate(JS_CHOOSE_NO_AI))
                await page.wait_for_timeout(500)
            await _click_first_visible(page, [r"^确认发布$", r"^确认提交$", r"^发布$", r"^提交$", r"^确定$", r"^下一步$"], 1500)
            await page.wait_for_timeout(800)
    finally:
        page.remove_listener("response", on_response)
    if "response" not in captured:
        debug = await _safe(page.evaluate(JS_DEBUG_STATE), {"url": page.url}) or {}
        raise driver_failed(
            f"未捕获到番茄发布接口 publish_article；url={debug.get('url')}; "
            f"buttons={json.dumps(debug.get('buttons') or [], ensure_ascii=False)[:1000]}"
        )
    await page.wait_for_timeout(5000)
    return captured["response"]


async def publish_chapter(page: Page, data: dict[str, Any], account_id: str, evidence_dir: Path) -> dict[str, Any]:
    """单章发布：打开新建页 → 填表 → 提交 → 回读同一作品的章节列表确认。"""
    evidence_dir.mkdir(parents=True, exist_ok=True)
    chapter_number = int(data["chapterNumber"])
    work = await _open_create_chapter_page(page, data["bookId"])
    latest_before = int(work.get("latestChapterNumber") or 0)
    if data.get("enforceContinuity") is not False and chapter_number != latest_before + 1:
        raise driver_failed(f"章节不连续，番茄最新: {latest_before}，待发布: {chapter_number}")

    cleaned = clean_content(data["content"])
    await _fill_chapter_number(page, chapter_number)
    await _fill_title(page, str(data["title"]))
    await _fill_content(page, cleaned)
    await _wait_for_auto_save(page, 10000)
    before_submit_url = page.url
    tag = f"{sanitize_file_part(account_id)}-{sanitize_file_part(data['bookId'])}-{chapter_number}-{int(time.time() * 1000)}"
    try:
        await _submit_publish(page)
    except Exception as error:
        screenshot = evidence_dir / f"failed-submit-{tag}.png"
        state_path = evidence_dir / f"failed-submit-{tag}.json"
        await _safe(page.screenshot(path=str(screenshot), full_page=True))
        debug = await _safe(page.evaluate(JS_DEBUG_STATE), {"url": page.url})
        state_path.write_text(json.dumps({"error": str(error), "debug": debug, "screenshotPath": str(screenshot)},
                                         ensure_ascii=False, indent=2), encoding="utf-8")
        raise driver_failed(f"{error}; debug={state_path}") from error

    chapters = await list_remote_chapters(page, data["bookId"])
    matched = next((c for c in chapters if int(c.get("chapterNumber") or 0) == chapter_number), None)
    screenshot = evidence_dir / f"publish-{tag}.png"
    state_path = evidence_dir / f"publish-{tag}.json"
    await _safe(page.screenshot(path=str(screenshot), full_page=True))
    result = {
        "success": bool(matched), "accountId": account_id, "bookId": str(data["bookId"]), "chapterNumber": chapter_number,
        "title": str(data["title"]), "work": work, "latestBefore": latest_before, "matchedChapter": matched,
        "confirmed": bool(matched), "beforeSubmitUrl": before_submit_url, "finalUrl": page.url,
        "wordCount": len(re.sub(r"\s+", "", cleaned)), "screenshotPath": str(screenshot), "statePath": str(state_path),
    }
    state_path.write_text(json.dumps({**result, "chapters": chapters}, ensure_ascii=False, indent=2), encoding="utf-8")
    if not matched:
        raise driver_failed(f"发布提交后未在远端章节列表确认第 {chapter_number} 章", result)
    return result


async def get_remote_chapter_detail(page: Page, book_id: str, item_id: str) -> dict[str, Any]:
    """打开章节编辑页，优先读后台 edit_article 接口返回的数据，取不到再读编辑器 DOM。"""
    edit_url = f"https://fanqienovel.com/main/writer/{book_id}/publish/{item_id}/?enter_from=modifychapter"
    detail: dict[str, Any] | None = None
    meta: dict[str, Any] = {}
    try:
        async with page.expect_response(
            lambda r: "/api/author/edit_article/v0/" in r.url and r.request.method == "GET" and r.ok, timeout=30000
        ) as response_info:
            await page.goto(edit_url, wait_until="domcontentloaded", timeout=60000)
        payload = await _safe((await response_info.value).json(), None)
    except Exception:  # noqa: BLE001
        payload = None
    discard = page.locator("button").filter(has_text=re.compile(r"^放弃$")).first
    if await _safe(discard.is_visible(), False):
        await _safe(discard.click())
        await page.wait_for_timeout(1500)
    await page.wait_for_selector(".ProseMirror", state="visible", timeout=20000)
    await page.wait_for_timeout(2000)
    if isinstance(payload, dict):
        data = payload.get("data") or {}
        meta = {"responseCode": payload.get("code") if isinstance(payload.get("code"), int) else None,
                "responseMessage": str(payload.get("message") or "")}
        if isinstance(data, dict) and (data.get("title") or data.get("content")):
            content_html = str(data.get("content") or "")
            text = html_to_plain_text(content_html)
            detail = {
                "chapterNumber": int(str(data.get("chapter") or data.get("serial") or 0) or 0),
                "title": str(data.get("title") or ""),
                "contentHtml": content_html,
                "contentText": text,
                "wordCount": int(str(data.get("word_number") or data.get("word_count") or 0) or 0) or len(text),
            }
    if not detail:
        detail = await page.evaluate(JS_EDITOR_DETAIL)
    return {"itemId": str(item_id), "bookId": str(book_id), "editUrl": edit_url, **detail, **meta,
            "contentText": normalize_text(detail.get("contentText"))}


def _summarize(detail: dict[str, Any]) -> dict[str, Any]:
    return {**detail, "contentHtml": str(detail.get("contentHtml") or "")[:400], "contentText": str(detail.get("contentText") or "")[:400]}


async def update_remote_chapter(page: Page, book_id: str, item_id: str, data: dict[str, Any], account_id: str,
                                evidence_dir: Path) -> dict[str, Any]:
    """修改已发布章节：改标题/正文 → 走发布确认 → 回读详情和章节列表核对。"""
    evidence_dir.mkdir(parents=True, exist_ok=True)
    before = await get_remote_chapter_detail(page, book_id, item_id)
    target_title = data.get("title") or before["title"]
    target_text = normalize_text(data["contentText"]) if data.get("contentText") else before["contentText"]
    title_input = page.locator('input[placeholder="请输入标题"]').first
    editor = page.locator(".ProseMirror").first
    network_events: list[dict[str, Any]] = []

    async def capture(response):
        if not re.search(r"/api/author/(edit_article|publish_article)/v0/", response.url):
            return
        body = await _safe(response.text(), "") or ""
        network_events.append({"url": response.url, "method": response.request.method, "status": response.status,
                               "ok": response.ok, "bodyPreview": body[:1000]})

    page.on("response", lambda r: asyncio.ensure_future(capture(r)))
    publish_payload = None
    try:
        await title_input.wait_for(state="visible", timeout=20000)
        await editor.wait_for(state="visible", timeout=20000)
        await _safe(page.evaluate(JS_REMOVE_HIDDEN_MODALS))
        await title_input.click(force=True)
        await _safe(title_input.press("Control+A"))
        await title_input.fill(target_title)
        await title_input.blur()
        if data.get("contentText"):
            await _safe(page.evaluate(JS_REMOVE_HIDDEN_MODALS))
            await editor.click(force=True)
            await _safe(page.keyboard.press("Control+A"))
            await page.keyboard.type(target_text, delay=1)
            await _safe(editor.blur())
        await page.wait_for_timeout(1500)
        async with page.expect_response(
            lambda r: "/api/author/publish_article/v0/" in r.url and r.request.method == "POST", timeout=30000
        ) as response_info:
            next_button = page.locator("button").filter(has_text=re.compile(r"^下一步$")).first
            await next_button.wait_for(state="visible", timeout=20000)
            deadline = time.monotonic() + 20
            while not await _safe(next_button.is_enabled(), False):
                if time.monotonic() > deadline:
                    raise driver_failed("按钮长时间未进入可点击状态")
                await asyncio.sleep(0.25)
            await _safe(page.evaluate(JS_REMOVE_HIDDEN_MODALS))
            await next_button.click(force=True)
            typo = page.locator(".arco-modal.auto-editor-error-modal.publish-modal-confirm").first
            if await _safe(typo.is_visible(timeout=3000), False):
                await _safe(page.evaluate(JS_REMOVE_HIDDEN_MODALS))
                await _click_modal_button(page, ".arco-modal.auto-editor-error-modal.publish-modal-confirm", "提交")
                await page.wait_for_timeout(500)
            confirm = page.locator(".arco-modal.publish-confirm-container-new").first
            if await _safe(confirm.is_visible(timeout=5000), False):
                ai_no = confirm.locator("label").filter(has_text=re.compile(r"^否$")).first
                if await ai_no.count():
                    await _safe(ai_no.click())
                    await page.wait_for_timeout(300)
                await _safe(page.evaluate(JS_REMOVE_HIDDEN_MODALS))
                await _click_modal_button(page, ".arco-modal.publish-confirm-container-new", "确认发布")
        publish_payload = await _safe((await response_info.value).json(), None)
    except Exception as error:  # noqa: BLE001
        # 没等到发布响应（超时）时继续走回读核对，由核对结果决定成败；其他界面操作失败直接报错。
        if not isinstance(error, PlaywrightTimeout):
            raise driver_failed(f"PUBLISH_UI_SUBMIT_FAILED: {error}") from error

    await _safe(page.wait_for_url(re.compile(r"/chapter-manage/"), timeout=30000))
    await page.wait_for_timeout(5000)
    after = await get_remote_chapter_detail(page, book_id, item_id)
    chapters = await list_remote_chapters(page, book_id)
    list_entry = next((c for c in chapters if c["itemId"] == str(item_id)), None)
    norm_target = normalize_chapter_title(target_title)
    norm_after = normalize_chapter_title(after.get("title"))
    norm_list = normalize_chapter_title((list_entry or {}).get("title"))
    verification = {
        "titleMatched": (norm_after == norm_target) if norm_after else (norm_list == norm_target),
        "contentMatched": (not data.get("contentText")) or normalize_text(after.get("contentText")) == normalize_text(target_text),
        "listTitleMatched": norm_list == norm_target,
        "reviewPending": "审核中" in str((list_entry or {}).get("status") or "") or "审核中" in str(after.get("responseMessage") or ""),
    }
    verified = verification["titleMatched"] and verification["contentMatched"] and verification["listTitleMatched"]
    accepted = isinstance(publish_payload, dict) and publish_payload.get("code") == 0
    accepted_pending = accepted and verification["titleMatched"] and verification["listTitleMatched"] and verification["reviewPending"]
    if not accepted and not verified and not accepted_pending:
        message = (publish_payload or {}).get("message") if isinstance(publish_payload, dict) else None
        raise driver_failed(f"番茄远端章节提交失败: {message or '未捕获到发布响应'}")
    tag = f"{sanitize_file_part(account_id)}-{sanitize_file_part(book_id)}-{sanitize_file_part(item_id)}-{int(time.time() * 1000)}"
    screenshot = evidence_dir / f"update-{tag}.png"
    state_path = evidence_dir / f"update-{tag}.json"
    await _safe(page.screenshot(path=str(screenshot), full_page=True))
    result = {
        "success": bool(verified or accepted_pending), "bookId": str(book_id), "itemId": str(item_id),
        "before": _summarize(before), "after": _summarize(after), "listEntry": list_entry, "publishPayload": publish_payload,
        "acceptedWithoutPayload": (not accepted) and verified, "acceptedPendingReview": accepted_pending,
        "verification": verification, "networkEvents": network_events,
        "screenshotPath": str(screenshot), "statePath": str(state_path),
    }
    state_path.write_text(json.dumps({**result, "beforeFull": before, "afterFull": after, "targetTitle": target_title,
                                      "targetContentText": target_text}, ensure_ascii=False, indent=2), encoding="utf-8")
    return result

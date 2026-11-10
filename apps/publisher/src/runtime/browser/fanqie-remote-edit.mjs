import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

import {
  resolveAccount,
  resolveBrowserExecutable,
  hydrateContextFromCookieBackup,
  persistContextCookies,
  cleanBrowserLocks,
  killBrowserProcessesForProfile,
  getAcceptanceDir,
} from './fanqie-runtime.mjs';

function readArg(flag, defaultValue = '') {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return defaultValue;
  }
  return String(process.argv[index + 1] || defaultValue);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sanitize(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizeChapterTitle(value) {
  return normalizeText(value)
    .replace(/^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s*/u, '')
    .trim();
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainTextToHtml(text) {
  return normalizeText(text)
    .split('\n')
    .map((line) => `<p>${line || '<br>'}</p>`)
    .join('');
}

function summarizeDetail(detail) {
  return {
    ...detail,
    contentHtml: String(detail?.contentHtml || '').slice(0, 400),
    contentText: String(detail?.contentText || '').slice(0, 400),
  };
}

function isRecoverableBrowserLaunchError(error) {
  const message = String(error?.message || error || '');
  return /ProcessSingleton|profile is already in use|SingletonLock|Target page, context or browser has been closed|Browser closed|browser has been closed|closed unexpectedly|ECONNRESET|ETIMEDOUT/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEnabled(locator, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('按钮长时间未进入可点击状态');
}

async function clickVisibleModalButton(page, modalSelector, buttonText) {
  const clicked = await page.evaluate(({ modalSelector, buttonText }) => {
    const modal = Array.from(document.querySelectorAll(modalSelector))
      .find((element) => {
        const htmlElement = element;
        return Boolean(htmlElement) && htmlElement.getAttribute('aria-hidden') !== 'true' && htmlElement.offsetParent !== null;
      });
    if (!modal) {
      return false;
    }
    const button = Array.from(modal.querySelectorAll('button'))
      .find((element) => (element.textContent || '').trim() === buttonText);
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }, { modalSelector, buttonText });

  if (!clicked) {
    throw new Error(`未找到弹窗按钮: ${buttonText}`);
  }
}

async function removeHiddenModalWrappers(page) {
  await page.evaluate(() => {
    const selectors = [
      '.byte-modal-wrapper[aria-hidden="true"]',
      '.arco-modal[aria-hidden="true"]',
      '.arco-modal-wrapper[aria-hidden="true"]',
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        element.remove();
      }
    }
  }).catch(() => {});
}

async function publishRemoteChapterViaApi(page, { bookId, itemId, title, contentText, overrides = {} }) {
  return page.evaluate(async ({ bookId, itemId, title, contentText, contentHtml, overrides }) => {
    const stripPrefix = (value) => String(value || '').replace(/^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s*/u, '').trim();
    const aid = '2503';
    const appName = 'muye_novel';
    const detailResponse = await fetch(
      `/api/author/edit_article/v0/?aid=${aid}&app_name=${appName}&book_id=${encodeURIComponent(bookId)}&item_id=${encodeURIComponent(itemId)}&from_source=0`,
      { credentials: 'include' }
    );
    const detailPayload = await detailResponse.json();
    const data = detailPayload?.data || {};
    const body = new URLSearchParams();
    body.set('aid', aid);
    body.set('app_name', appName);
    body.set('item_id', String(itemId));
    body.set('book_id', String(bookId));
    body.set('content', contentText ? String(contentHtml || '') : String(data.content || ''));
    const originalTitle = String(data.title || '');
    const prefixMatch = originalTitle.match(/^(第\s*[0-9一二三四五六七八九十百千万零两]+\s*章)\s*/u);
    const normalizedTitle = stripPrefix(title || originalTitle);
    body.set('title', prefixMatch ? `${prefixMatch[1]} ${normalizedTitle}` : normalizedTitle);
    body.set('volume_id', String(overrides.volumeId || data.volume_id || data.volume_data?.[0]?.volume_id || ''));
    body.set('volume_name', String(overrides.volumeName || data.volume_name || data.volume_data?.[0]?.volume_name || ''));
    body.set('timer_status', String(overrides.timerStatus ?? data.timer_status ?? 0));
    body.set('timer_time', String(overrides.timerTime ?? data.timer_time ?? 0));
    body.set('platform', String(overrides.platform ?? data.column_data?.platform ?? 2));
    body.set('need_pay', String(overrides.needPay ?? data.column_data?.need_pay ?? 0));
    body.set('sale_type', String(overrides.saleType ?? data.column_data?.sale_type ?? 0));
    body.set('real_order', String(overrides.realOrder ?? data.real_order ?? 0));
    body.set('latest_version', String(overrides.latestVersion ?? data.latest_version ?? 0));
    body.set('display_status', String(overrides.displayStatus ?? data.display_status ?? 1));
    body.set('use_ai', String(overrides.useAi ?? data.use_ai ?? 2));

    const publishResponse = await fetch('/api/author/publish_article/v0/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: body.toString(),
    });
    const responseText = await publishResponse.text().catch(() => '');
    let publishPayload = null;
    try {
      publishPayload = responseText ? JSON.parse(responseText) : null;
    } catch {
      publishPayload = null;
    }
    return {
      publishPayload,
      responseStatus: publishResponse.status,
      responseOk: publishResponse.ok,
      responseText: String(responseText || '').slice(0, 1000),
      requestBody: Object.fromEntries(body.entries()),
    };
  }, {
    bookId: String(bookId),
    itemId: String(itemId),
    title: String(title || ''),
    contentText: String(contentText || ''),
    contentHtml: contentText ? plainTextToHtml(contentText) : '',
    overrides,
  });
}

async function createRuntime(accountId) {
  const dataDir = process.env.FANQIE_SERVICE_DATA_DIR || '.runtime/fanqie-service';
  const rootDir = process.env.FANQIE_SERVICE_ROOT || process.cwd();
  const contentBaseRoot = process.env.FANQIE_CONTENTBASE_ROOT || '';
  const account = await resolveAccount({ dataDir, rootDir, contentBaseRoot, accountId });
  const executablePath = resolveBrowserExecutable();
  const acceptanceDir = path.join(getAcceptanceDir(rootDir), 'remote-edit');
  fs.mkdirSync(acceptanceDir, { recursive: true });
  let context = null;
  let lastError = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      cleanBrowserLocks(account.browserDir);
      if (attempt > 1) {
        killBrowserProcessesForProfile(account.browserDir);
        cleanBrowserLocks(account.browserDir);
        await sleep(800 * attempt);
      }
      context = await chromium.launchPersistentContext(account.browserDir, {
        headless: true,
        executablePath,
        viewport: { width: 1800, height: 1400 },
        args: ['--no-sandbox', '--window-size=1920,1200', '--test-type'],
      });
      break;
    } catch (error) {
      lastError = error;
      if (!isRecoverableBrowserLaunchError(error) || attempt >= maxAttempts) {
        throw new Error(`fanqie runtime launch failed after ${attempt} attempts: ${String(error?.message || error)}`);
      }
      await sleep(500 * attempt);
    }
  }

  if (!context) {
    throw new Error(`fanqie runtime launch failed: ${String(lastError?.message || lastError || 'unknown error')}`);
  }

  await hydrateContextFromCookieBackup(context, account).catch(() => {});
  const page = context.pages()[0] || await context.newPage();

  return {
    rootDir,
    account,
    executablePath,
    acceptanceDir,
    context,
    page,
  };
}

async function closeRuntime(runtime) {
  await persistContextCookies(runtime.context, runtime.account).catch(() => {});
  await runtime.context.close().catch(() => {});
}

async function gotoBookManage(runtime) {
  const { page } = runtime;
  await page.goto('https://fanqienovel.com/main/writer/book-manage', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('[id^="long-article-table-item-"]', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function listWorks(runtime) {
  await gotoBookManage(runtime);
  return runtime.page.evaluate(() => {
    return Array.from(document.querySelectorAll('[id^="long-article-table-item-"]')).map((item) => {
      const id = item.id.replace('long-article-table-item-', '');
      const title = item.querySelector('.hoverup')?.textContent?.split('\n')[0]?.trim() || '';
      const text = item.textContent || '';
      const latestLabel = Array.from(item.querySelectorAll('a'))
        .map((el) => el.textContent?.trim() || '')
        .find((value) => /^第.+章/.test(value)) || '';
      const latestChapterNumber = Number.parseInt((latestLabel.match(/第\s*(\d+)\s*章/) || [])[1] || '0', 10) || 0;
      const chapterManageUrl = Array.from(item.querySelectorAll('a'))
        .map((el) => el.href || '')
        .find((href) => href.includes('/chapter-manage/')) || '';
      const createChapterUrl = Array.from(item.querySelectorAll('a'))
        .map((el) => el.href || '')
        .find((href) => href.includes('/publish/')) || '';

      let status = '连载中';
      if (text.includes('已签约')) status = '已签约';
      else if (text.includes('已完结')) status = '已完结';
      else if (text.includes('停止推荐')) status = '已停止推荐';
      else if (text.includes('待审核')) status = '待审核';

      const chapterCount = Number.parseInt((text.match(/(\d+)\s*章/) || [])[1] || '0', 10) || 0;
      const wordCount = (text.match(/(\d+\.?\d*)\s*万字/) || [])[0] || (text.includes('0 字') ? '0字' : '');

      return {
        id,
        title,
        status,
        chapterCount,
        wordCount,
        latestChapterLabel: latestLabel,
        latestChapterNumber,
        chapterManageUrl,
        createChapterUrl,
      };
    }).filter((item) => item.id && item.title);
  });
}

async function resolveChapterManageUrl(runtime, bookId) {
  const works = await listWorks(runtime);
  const work = works.find((item) => item.id === String(bookId));
  if (!work?.chapterManageUrl) {
    throw new Error(`未找到作品或章节管理链接: ${bookId}`);
  }
  return { work, works };
}

async function listRemoteChapters(runtime, bookId) {
  const { page } = runtime;
  const { work } = await resolveChapterManageUrl(runtime, bookId);
  await page.goto(work.chapterManageUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table tbody tr', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
  const all = [];
  const seen = new Set();
  const maxPages = 50;
  let lastTotal = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const collectRows = async () => {
      return page.evaluate(() => {
        return Array.from(document.querySelectorAll('table tbody tr')).map((row, index) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const previewLink = row.querySelector('a[href*="/preview/"]');
          const editLink = row.querySelector('a[href*="/publish/"]');
          const title = cells[0]?.textContent?.trim() || previewLink?.textContent?.trim() || '';
          const itemId = (editLink?.getAttribute('href')?.match(/\/publish\/([^/?]+)\//) || previewLink?.getAttribute('href')?.match(/&([^&/?]+)$/) || [])[1] || '';
          const chapterNumber = Number.parseInt((title.match(/第\s*(\d+)\s*章/) || [])[1] || '0', 10) || 0;
          return {
            itemId,
            title,
            chapterNumber,
            listIndex: index + 1,
            wordCount: Number.parseInt(cells[1]?.textContent?.trim() || '0', 10) || 0,
            typoCount: Number.parseInt(cells[2]?.textContent?.trim() || '0', 10) || 0,
            status: cells[3]?.textContent?.trim() || '',
            publishedAt: cells[4]?.textContent?.trim() || '',
            previewUrl: previewLink?.href || '',
            editUrl: editLink?.href || '',
          };
        }).filter((item) => item.itemId && item.title);
      });
    };

    const scrollTargetsToBottom = async () => {
      await page.evaluate(() => {
        const candidates = [
          document.querySelector('.arco-table-body'),
          document.querySelector('.arco-table-body-inner'),
          document.querySelector('.arco-table-container'),
          document.scrollingElement || document.documentElement || document.body,
        ];
        candidates.filter(Boolean).forEach((target) => {
          target.scrollTop = target.scrollHeight;
        });
      });
    };

    // 自动滚动加载：适配懒加载/虚拟列表（以“新增章节数”为停止条件）
    let stableRounds = 0;
    while (stableRounds < 3) {
      const beforeCount = all.length;
      const rows = await collectRows();
      rows.forEach((item) => {
        if (!item.itemId || seen.has(item.itemId)) return;
        seen.add(item.itemId);
        all.push(item);
      });

      if (all.length === beforeCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      await scrollTargetsToBottom();
      await page.waitForTimeout(900);
    }

    if (all.length <= lastTotal) {
      break;
    }
    lastTotal = all.length;

    const nextButton = page.locator(
      '.arco-pagination-next, .arco-pagination-item-next, button[aria-label="下一页"], button:has-text("下一页"), a:has-text("下一页")'
    ).first();
    const isVisible = await nextButton.isVisible().catch(() => false);
    if (!isVisible) {
      break;
    }
    const ariaDisabled = (await nextButton.getAttribute('aria-disabled').catch(() => null)) || '';
    const className = (await nextButton.getAttribute('class').catch(() => null)) || '';
    const isDisabled = ariaDisabled === 'true' || /disabled|arco-pagination-item-disabled/i.test(className);
    const isEnabled = await nextButton.isEnabled().catch(() => !isDisabled);
    if (isDisabled || !isEnabled) {
      break;
    }
    await nextButton.click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.waitForSelector('table tbody tr', { state: 'visible', timeout: 20000 });
  }

  return all;
}

async function getRemoteChapterDetail(runtime, bookId, itemId) {
  const { page } = runtime;
  const editUrl = `https://fanqienovel.com/main/writer/${encodeURIComponent(bookId)}/publish/${encodeURIComponent(itemId)}/?enter_from=modifychapter`;
  const detailResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/author/edit_article/v0/')
      && response.request().method() === 'GET'
      && response.ok();
  }, { timeout: 30000 }).catch(() => null);

  await page.goto(editUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const discardDraftButton = page.locator('button').filter({ hasText: /^放弃$/ }).first();
  if (await discardDraftButton.isVisible().catch(() => false)) {
    await discardDraftButton.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('.ProseMirror', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(2000);

  let detail = null;
  let detailMeta = null;
  const detailResponse = await detailResponsePromise;
  if (detailResponse) {
    const payload = await detailResponse.json().catch(() => null);
    const data = payload?.data || {};
    detailMeta = {
      responseCode: typeof payload?.code === 'number' ? payload.code : null,
      responseMessage: String(payload?.message || ''),
    };
    if (data && typeof data === 'object' && (data.title || data.content)) {
      detail = {
        chapterNumber: Number.parseInt(String(data.chapter || data.serial || 0), 10) || 0,
        title: String(data.title || ''),
        contentHtml: String(data.content || ''),
        contentText: htmlToPlainText(String(data.content || '')),
        wordCount: Number.parseInt(String(data.word_number || data.word_count || 0), 10) || htmlToPlainText(String(data.content || '')).length,
      };
    }
  }

  if (!detail) {
    detail = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const numberInput = inputs.find((el) => (el.className || '').includes('serial-input') && String(el.value || '').trim());
      const titleInput = document.querySelector('input[placeholder="请输入标题"]');
      const editor = document.querySelector('.ProseMirror');

      return {
        chapterNumber: Number.parseInt(numberInput?.value || '0', 10) || 0,
        title: titleInput?.value || '',
        contentHtml: editor?.innerHTML || '',
        contentText: editor?.textContent || '',
        wordCount: (editor?.textContent || '').length,
      };
    });
  }

  return {
    itemId: String(itemId),
    bookId: String(bookId),
    editUrl,
    ...detail,
    ...detailMeta,
    contentText: normalizeText(detail.contentText),
  };
}

async function updateRemoteChapter(runtime, bookId, itemId, payload = {}) {
  const { page, acceptanceDir, account } = runtime;
  const before = await getRemoteChapterDetail(runtime, bookId, itemId);
  const targetTitle = typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : before.title;
  const targetContentText = typeof payload.contentText === 'string' && payload.contentText.length > 0
    ? normalizeText(payload.contentText)
    : before.contentText;

  const titleInput = page.locator('input[placeholder="请输入标题"]').first();
  const editor = page.locator('.ProseMirror').first();

  let publishPayload = null;
  let publishRequestBody = null;
  let publishResponseMeta = null;
  const networkEvents = [];

  const captureResponse = async (response) => {
    const url = String(response?.url?.() || '');
    if (!/\/api\/author\/(edit_article|publish_article)\/v0\//.test(url)) {
      return;
    }
    const request = response.request();
    let body = '';
    try {
      body = await response.text();
    } catch {}
    networkEvents.push({
      url,
      method: request?.method?.() || '',
      status: response.status(),
      ok: response.ok(),
      bodyPreview: String(body || '').slice(0, 1000),
    });
  };

  page.on('response', captureResponse);

  try {
    await titleInput.waitFor({ state: 'visible', timeout: 20000 });
    await editor.waitFor({ state: 'visible', timeout: 20000 });

    await page.evaluate(() => {
      for (const element of document.querySelectorAll('.byte-modal-wrapper[aria-hidden="true"]')) {
        element.remove();
      }
    }).catch(() => {});

    await removeHiddenModalWrappers(page);
    await titleInput.click({ force: true });
    await titleInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await titleInput.fill(targetTitle);
    await titleInput.blur();

    if (payload.contentText) {
      await removeHiddenModalWrappers(page);
      await editor.click({ force: true });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
      await page.keyboard.type(targetContentText, { delay: 1 });
      await editor.blur().catch(() => {});
    }

    await page.waitForTimeout(1500);

    const publishResponsePromise = page.waitForResponse((response) => {
      return response.url().includes('/api/author/publish_article/v0/')
        && response.request().method() === 'POST';
    }, { timeout: 30000 }).catch(() => null);

    const nextButton = page.locator('button').filter({ hasText: /^下一步$/ }).first();
    await nextButton.waitFor({ state: 'visible', timeout: 20000 });
    await waitForEnabled(nextButton, 20000);
    await removeHiddenModalWrappers(page);
    await nextButton.click({ force: true });

    const typoDialog = page.locator('.arco-modal.auto-editor-error-modal.publish-modal-confirm').first();
    if (await typoDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      await removeHiddenModalWrappers(page);
      await clickVisibleModalButton(page, '.arco-modal.auto-editor-error-modal.publish-modal-confirm', '提交');
      await page.waitForTimeout(500);
    }

    const confirmDialog = page.locator('.arco-modal.publish-confirm-container-new').first();
    if (await confirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      const aiNoLabel = confirmDialog.locator('label').filter({ hasText: /^否$/ }).first();
      if (await aiNoLabel.count()) {
        await aiNoLabel.click().catch(() => {});
        await page.waitForTimeout(300);
      }

      await removeHiddenModalWrappers(page);
      await clickVisibleModalButton(page, '.arco-modal.publish-confirm-container-new', '确认发布');
    }

    const publishResponse = await publishResponsePromise;
    publishPayload = publishResponse ? await publishResponse.json().catch(() => null) : null;
  } catch (error) {
    throw new Error(`PUBLISH_UI_SUBMIT_FAILED: ${String(error?.message || error || 'unknown-error')}`);
  }

  try {
    await page.waitForURL(/\/chapter-manage\//, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const after = await getRemoteChapterDetail(runtime, bookId, itemId);
    const remoteChapters = await listRemoteChapters(runtime, bookId);
    const listEntry = remoteChapters.find((chapter) => chapter.itemId === String(itemId)) || null;
    const normalizedTargetTitle = normalizeChapterTitle(targetTitle);
    const normalizedAfterTitle = normalizeChapterTitle(after.title);
    const normalizedListTitle = normalizeChapterTitle(listEntry?.title || '');
    const reviewPending = /审核中/.test(String(listEntry?.status || ''))
      || /审核中/.test(String(after?.responseMessage || ''));
    const contentMatched = !payload.contentText
      || normalizeText(after.contentText) === normalizeText(targetContentText);
    const verification = {
      titleMatched: normalizedAfterTitle
        ? normalizedAfterTitle === normalizedTargetTitle
        : normalizedListTitle === normalizedTargetTitle,
      contentMatched,
      listTitleMatched: normalizedListTitle === normalizedTargetTitle,
      reviewPending,
    };
    const verifiedByState = verification.titleMatched && verification.contentMatched && verification.listTitleMatched;
    const publishAccepted = Boolean(publishPayload?.code === 0);
    const acceptedWithoutPayload = !publishAccepted && verifiedByState;
    const acceptedPendingReview = publishAccepted
      && verification.titleMatched
      && verification.listTitleMatched
      && verification.reviewPending;

    if (!publishAccepted && !acceptedWithoutPayload && !acceptedPendingReview) {
      throw new Error(`番茄远端章节提交失败: ${publishPayload?.message || publishResponseMeta?.bodyPreview || '未捕获到发布响应'}`);
    }

    const tag = `${sanitize(account.id)}-${sanitize(bookId)}-${sanitize(itemId)}-${Date.now()}`;
    const screenshotPath = path.join(acceptanceDir, `update-${tag}.png`);
    const statePath = path.join(acceptanceDir, `update-${tag}.json`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const result = {
      success: verifiedByState || acceptedPendingReview,
      bookId: String(bookId),
      itemId: String(itemId),
      before: summarizeDetail(before),
      after: summarizeDetail(after),
      listEntry,
      publishPayload,
      publishRequestBody,
      publishResponseMeta,
      acceptedWithoutPayload,
      acceptedPendingReview,
      verification,
      networkEvents,
      screenshotPath,
      statePath,
    };
    fs.writeFileSync(statePath, JSON.stringify({
      ...result,
      beforeFull: before,
      afterFull: after,
      targetTitle,
      targetContentText,
    }, null, 2), 'utf8');
    return result;
  } finally {
    page.off('response', captureResponse);
  }
}

async function main() {
  const command = readArg('--command');
  const accountId = readArg('--account');
  const runtime = await createRuntime(accountId);

  try {
    if (command === 'works-live') {
      const data = await listWorks(runtime);
      console.log(JSON.stringify({ success: true, data }, null, 2));
      return;
    }

    if (command === 'remote-chapters') {
      const bookId = readArg('--book-id');
      const data = await listRemoteChapters(runtime, bookId);
      console.log(JSON.stringify({ success: true, data }, null, 2));
      return;
    }

    if (command === 'remote-chapter-detail') {
      const bookId = readArg('--book-id');
      const itemId = readArg('--item-id');
      const data = await getRemoteChapterDetail(runtime, bookId, itemId);
      console.log(JSON.stringify({ success: true, data }, null, 2));
      return;
    }

    if (command === 'remote-chapter-update') {
      const bookId = readArg('--book-id');
      const itemId = readArg('--item-id');
      const payloadFile = readArg('--payload-file');
      const stdinPayload = process.argv.includes('--payload-stdin');
      const payload = stdinPayload
        ? JSON.parse(await readStdin())
        : payloadFile
        ? JSON.parse(fs.readFileSync(path.resolve(payloadFile), 'utf8'))
        : {};
      const data = await updateRemoteChapter(runtime, bookId, itemId, payload);
      console.log(JSON.stringify({ success: true, data }, null, 2));
      return;
    }

    throw new Error(`unsupported_command: ${command}`);
  } finally {
    await closeRuntime(runtime);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});

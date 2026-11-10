import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  cleanBrowserLocks,
  getAcceptanceDir,
  hydrateContextFromCookieBackup,
  killBrowserProcessesForProfile,
  persistContextCookies,
  resolveAccount,
  resolveBrowserExecutable,
  sanitizeFilePart,
  defaultServiceDataDir,
} from './fanqie-runtime.mjs';

// 发布脚本是 ScriptFanqiePlatformDriver 调用的浏览器执行入口。
// 支持两类模式：
// - --command works-live / remote-chapters：只读扫描番茄后台。
// - --payload-file / --payload-stdin：执行单章发布并回读远端章节确认。
function readArg(flag, defaultValue = '') {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return defaultValue;
  return String(process.argv[index + 1] || defaultValue);
}

async function readStdin() {
  // driver 通过 stdin 传 payload，避免长正文出现在命令行参数里。
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeText(value) {
  // 统一换行和空格，保证后续转 HTML/字数统计使用同一份文本。
  return String(value || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

function plainTextToHtml(text) {
  // 番茄编辑器接收富文本 DOM，这里把纯文本按段落转换成最小 HTML。
  return normalizeText(text)
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('');
}

function escapeHtml(value) {
  // 写入 contenteditable 前转义用户正文，避免把正文中的 HTML 当成标签执行。
  return String(value || '') // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanContent(content) {
  // 清理从上游编辑器/AI 工具泄漏进正文的控制文字和定位噪声。
  const junkPatterns = [
    /arrivedat\w+\.?\s*/gi,
    /location:\s*\w+\.?\s*/gi,
    /「「([^」]+)」\d+」/g,
    /」\d+」/g,
  ];
  let cleaned = normalizeText(content);
  for (const pattern of junkPatterns) cleaned = cleaned.replace(pattern, '');
  const junkLines = ['章节概要', '总结当前章节概要', '批量生成概要', '处理配置', '已启用', 'AI 模型'];
  return cleaned
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (junkLines.some((item) => trimmed.includes(item))) return false;
      if (/^[a-zA-Z\s,.'"]+$/.test(trimmed) && trimmed.length > 5) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isRecoverableBrowserLaunchError(error) {
  // profile 被占用或浏览器瞬断时允许重试；其他错误直接暴露。
  const message = String(error?.message || error || ''); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  return /ProcessSingleton|profile is already in use|SingletonLock|Target page, context or browser has been closed|Browser closed|browser has been closed|closed unexpectedly|ECONNRESET|ETIMEDOUT/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRuntime(accountId, headless) {
  // 创建一次发布/扫描运行时：解析账号、定位浏览器、启动持久化 profile、
  // 注入 本地存储 cookie，并返回 Playwright page/context。
  const dataDir = defaultServiceDataDir();
  const rootDir = process.env.FANQIE_SERVICE_ROOT || process.cwd();
  const contentBaseRoot = process.env.FANQIE_CONTENTBASE_ROOT || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  const account = await resolveAccount({ dataDir, rootDir, contentBaseRoot, accountId });
  const executablePath = resolveBrowserExecutable();
  const acceptanceDir = path.join(getAcceptanceDir(rootDir), 'publish');
  fs.mkdirSync(acceptanceDir, { recursive: true });

  let context = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      cleanBrowserLocks(account.browserDir);
      if (attempt > 1) {
        killBrowserProcessesForProfile(account.browserDir);
        cleanBrowserLocks(account.browserDir);
        await sleep(800 * attempt);
      }
      context = await chromium.launchPersistentContext(account.browserDir, {
        headless,
        executablePath,
        viewport: { width: 1800, height: 1400 },
        args: ['--no-sandbox', '--window-size=1920,1200', '--test-type'],
      });
      break;
    } catch (error) {
      lastError = error;
      if (!isRecoverableBrowserLaunchError(error) || attempt >= 3) {
        throw new Error(`fanqie publish browser launch failed after ${attempt} attempts: ${String(error?.message || error)}`); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      }
    }
  }
  if (!context) throw lastError || new Error('fanqie publish browser launch failed');
  await hydrateContextFromCookieBackup(context, account).catch(() => {});
  const page = context.pages()[0] || await context.newPage();
  return { rootDir, account, acceptanceDir, context, page };
}

async function closeRuntime(runtime) {
  // 关闭前尝试回写 cookie，保证手动登录或后台刷新后的 session 能沉淀回本地存储。
  await persistContextCookies(runtime.context, runtime.account).catch(() => {});
  await runtime.context.close().catch(() => {});
}

async function gotoBookManage(page) {
  // 进入作者后台作品管理页；后续扫描和发布入口发现都从这里开始。
  await page.goto('https://fanqienovel.com/main/writer/book-manage', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('[id^="long-article-table-item-"]', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  await closePopups(page);
}

async function listWorks(page) {
  // 读取当前账号可见的番茄作品列表。
  await gotoBookManage(page);
  return page.evaluate(() => {
    // 番茄 bookId 从后台 DOM id 解析：long-article-table-item-{bookId}。
    // 这是发布用的远端作品身份；标题和作者只是展示字段，不能保证唯一。
    return Array.from(document.querySelectorAll('[id^="long-article-table-item-"]')).map((item) => {
      const id = item.id.replace('long-article-table-item-', '');
      const title = item.querySelector('.hoverup')?.textContent?.split('\n')[0]?.trim() || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      const latestLabel = Array.from(item.querySelectorAll('a'))
        .map((el) => el.textContent?.trim() || '') // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        .find((value) => /^第.+章/.test(value)) || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      const latestChapterNumber = Number.parseInt((latestLabel.match(/第\s*(\d+)\s*章/) || [])[1] || '0', 10) || 0; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      const chapterManageUrl = Array.from(item.querySelectorAll('a'))
        .map((el) => el.href || '') // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        .find((href) => href.includes('/chapter-manage/')) || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      const createChapterUrl = Array.from(item.querySelectorAll('a'))
        .map((el) => el.href || '') // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        .find((href) => href.includes('/publish/')) || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      return { id, title, latestChapterLabel: latestLabel, latestChapterNumber, chapterManageUrl, createChapterUrl };
    }).filter((item) => item.id && item.title);
  });
}

async function listRemoteChapters(page, bookId) {
  // 进入指定作品的章节管理页，分页读取远端章节快照。
  const works = await listWorks(page);
  const work = works.find((item) => item.id === String(bookId));
  if (!work?.chapterManageUrl) throw new Error(`未找到作品或章节管理链接: ${bookId}`); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  await page.goto(work.chapterManageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('table tbody tr', { state: 'visible', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const all = [];
  const seen = new Set();
  for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
    const rows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table tbody tr')).map((row, index) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const previewLink = row.querySelector('a[href*="/preview/"]');
        const editLink = row.querySelector('a[href*="/publish/"]');
        const title = cells[0]?.textContent?.trim() || previewLink?.textContent?.trim() || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        const itemId = (editLink?.getAttribute('href')?.match(/\/publish\/([^/?]+)\//) || previewLink?.getAttribute('href')?.match(/&([^&/?]+)$/) || [])[1] || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        const chapterNumber = Number.parseInt((title.match(/第\s*(\d+)\s*章/) || [])[1] || '0', 10) || 0; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        return {
          itemId,
          title,
          chapterNumber,
          listIndex: index + 1,
          wordCount: Number.parseInt(cells[1]?.textContent?.trim() || '0', 10) || 0, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          status: cells[3]?.textContent?.trim() || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          publishedAt: cells[4]?.textContent?.trim() || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        };
      }).filter((item) => item.itemId && item.title);
    });
    for (const row of rows) {
      if (seen.has(row.itemId)) continue;
      seen.add(row.itemId);
      all.push(row);
    }
    const nextButton = page.locator('.arco-pagination-next, .arco-pagination-item-next, button[aria-label="下一页"], button:has-text("下一页"), a:has-text("下一页")').first();
    const visible = await nextButton.isVisible().catch(() => false);
    if (!visible) break;
    const className = await nextButton.getAttribute('class').catch(() => '') || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    const disabled = /disabled|arco-pagination-item-disabled/i.test(className) || await nextButton.getAttribute('aria-disabled').catch(() => '') === 'true';
    if (disabled || !(await nextButton.isEnabled().catch(() => false))) break;
    await nextButton.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  return all;
}

async function openCreateChapterPage(page, bookId) {
  // 打开指定 bookId 的新建章节页面；bookId 是远端作品唯一保护栏。
  const works = await listWorks(page);
  // bookId 是决定“发到哪个番茄作品”的保护栏。当前账号后台里如果看不到
  // 这个精确作品，脚本直接失败，不靠作品名或作者名猜。
  const work = works.find((item) => item.id === String(bookId));
  if (!work) throw new Error(`未找到作品: ${bookId}`);
  if (work.createChapterUrl) {
    await page.goto(work.createChapterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else if (work.chapterManageUrl) {
    await page.goto(work.chapterManageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);
    const href = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('a')).find((item) => /^(新建章节|创建章节)$/.test(item.textContent?.trim())); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      return link?.getAttribute('href') || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    });
    if (href) {
      await page.goto(href.startsWith('http') ? href : `https://fanqienovel.com${href}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      const button = page.locator('a, button').filter({ hasText: /^新建章节$/ }).first();
      await button.click({ timeout: 10000 });
    }
  } else {
    throw new Error(`作品缺少新建章节入口: ${bookId}`);
  }
  await Promise.race([
    page.waitForSelector('input[type="text"], input[type="number"], [contenteditable="true"], textarea, .ProseMirror', { state: 'visible', timeout: 30000 }),
    page.waitForURL(/\/publish\//, { timeout: 30000 }).catch(() => {}),
  ]);
  await page.waitForTimeout(1000);
  await closePopups(page);
  return work;
}

async function fillChapterForm(page, input) {
  // 按顺序填写章节号、标题、正文，并等待编辑器自动保存稳定。
  const cleanedContent = cleanContent(input.content);
  await fillChapterNumber(page, input.chapterNumber);
  await fillTitle(page, input.title);
  await fillContent(page, cleanedContent);
  await waitForAutoSave(page, 10000);
  return { cleanedContent, wordCount: cleanedContent.replace(/\s+/g, '').length };
}

async function fillChapterNumber(page, chapterNumber) {
  // 番茄章节号输入框没有稳定公开 API，因此先走 DOM 精确填充，
  // 失败后再按可见 input 的属性和标签做定位。
  const domFilled = await page.evaluate((value) => {
    const inputs = Array.from(document.querySelectorAll('input')).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const text = `${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.className || ''}`.toLowerCase(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      if (text.includes('title') || text.includes('标题') || text.includes('chapter-title')) return false;
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled && !el.readOnly;
    });
    const exact = inputs.find((el) => String(el.className || '').includes('serial-input')) // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      || inputs.find((el) => el.type === 'number' || el.inputMode === 'numeric')
      || inputs[0];
    if (!exact) return false;
    const proto = Object.getPrototypeOf(exact);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(exact, String(value)); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    else exact.value = String(value);
    exact.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    exact.dispatchEvent(new Event('change', { bubbles: true }));
    exact.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, String(chapterNumber)).catch(() => false);
  if (domFilled) {
    await page.waitForTimeout(500);
    const visibleText = await page.locator('body').innerText().catch(() => '');
    if (visibleText.includes(`第${chapterNumber}章`) || visibleText.includes(`第\n${chapterNumber}\n章`) || visibleText.includes(`${chapterNumber}`)) {
      return;
    }
  }

  const allInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map((el, index) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const formItem = el.closest('.arco-form-item, .byte-form-item, .form-item');
      const labelText = formItem?.querySelector('label, .arco-form-item-label, .byte-form-item-label')?.textContent?.trim() || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      return {
        index,
        type: el.type,
        inputMode: el.inputMode || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        placeholder: el.placeholder || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        name: el.name || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        id: el.id || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        labelText,
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && el.getAttribute('aria-hidden') !== 'true' && !el.disabled && !el.readOnly,
      };
    });
  });
  const candidate = allInputs.filter((item) => item.visible).find((item) => {
    const combined = `${item.placeholder} ${item.name} ${item.id} ${item.labelText}`.toLowerCase();
    if (/标题|章节名|title|请输入标题/.test(combined)) return false;
    return item.type === 'number' || item.inputMode === 'numeric' || /章节号|章节数|章序号|序号|chapter|number|第几章/.test(combined);
  });
  if (candidate) {
    await page.locator('input').nth(candidate.index).fill(String(chapterNumber));
    return;
  }
  for (const selector of ['input[placeholder*="章节号"]', 'input[placeholder*="章节数"]', 'input[placeholder*="第"]', 'input[name*="chapter"]', 'input[name*="number"]']) {
    const input = page.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(String(chapterNumber));
      return;
    }
  }
  const serialInput = allInputs
    .filter((item) => item.visible)
    .filter((item) => {
      const combined = `${item.placeholder} ${item.name} ${item.id} ${item.labelText}`.toLowerCase();
      return !/标题|章节名|title|请输入标题/.test(combined);
    })
    .sort((a, b) => a.index - b.index)[0];
  if (serialInput) {
    await page.locator('input').nth(serialInput.index).fill(String(chapterNumber));
  }
}

async function fillTitle(page, title) {
  // 等待标题输入框出现（fillChapterNumber 后页面可能重渲染）。
  await page.waitForTimeout(1500);
  for (const selector of ['input.serial-editor-input-hint-area', 'input[placeholder*="标题"]', 'input[placeholder*="请输入标题"]', 'input[placeholder*="章节名"]', 'input[name*="title"]', '[data-e2e="chapter-title-input"] input', '.chapter-title input']) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill(String(title));
      return;
    }
  }
  throw new Error('无法找到章节标题输入框');
}

async function fillContent(page, content) {
  // 正文编辑器可能是 ProseMirror/contenteditable/textarea，按可见编辑面依次尝试。
  for (const selector of ['.ProseMirror', '[contenteditable="true"]', '.editor-content', 'textarea', '[data-e2e="chapter-content-editor"]']) {
    const editor = page.locator(selector).first();
    if (!(await editor.isVisible().catch(() => false))) continue;
    if (selector === 'textarea') {
      await editor.fill(content);
      return;
    }
    await editor.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    // 用剪贴板粘贴写入 ProseMirror（innerHTML 不触发编辑器内部状态）
    await page.evaluate(async (text) => {
      const clipData = new DataTransfer();
      clipData.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', { clipboardData: clipData, bubbles: true, cancelable: true });
      const el = document.querySelector('.ProseMirror, [contenteditable="true"], .editor-content');
      if (el) el.dispatchEvent(pasteEvent);
    }, content);
    await page.waitForTimeout(1000);
    const length = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror, [contenteditable="true"], .editor-content');
      return (editor?.textContent || '').replace(/\s+/g, '').length; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    });
    if (length > 0) return;
    // 粘贴失败时回退到 keyboard.insertText
    await editor.click({ force: true }).catch(() => {});
    await page.keyboard.selectAll();
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(content);
    await page.waitForTimeout(1000);
    const length2 = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror, [contenteditable="true"], .editor-content');
      return (editor?.textContent || '').replace(/\s+/g, '').length; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    });
    if (length2 > 0) return;
  }
  throw new Error('无法找到正文编辑器');
}

async function waitForAutoSave(page, timeoutMs) {
  // 番茄编辑器会自动保存；看到保存成功或页面稳定一段时间后再继续提交。
  const start = Date.now();
  let stableSince = 0;
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const text = document.body?.textContent || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      if (text.includes('已保存') || text.includes('保存成功')) return 'saved';
      const saving = document.querySelector('[class*="saving"], [class*="Saving"]');
      return saving ? 'saving' : 'idle';
    }).catch(() => 'idle');
    if (state === 'saved') return;
    if (state === 'idle') {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 800) return;
    } else {
      stableSince = 0;
    }
    await page.waitForTimeout(250);
  }
}

async function submitPublish(page) {
  // 点击发布流程，并监听真正的 publish_article POST 请求；
  // 捕获不到该请求时不能把页面按钮点击当作发布成功。
  let publishResponse = null;
  const onResponse = (response) => {
    if (response.url().includes('/api/author/publish_article/v0/') && response.request().method() === 'POST') {
      publishResponse = response;
    }
  };
  page.on('response', onResponse);

  const deadline = Date.now() + 90000;
  try {
    // 先关闭可能存在的内容检测结果面板（"知道了"按钮）
    await dismissDetectionPanel(page);
    await clickFirstVisible(page, [/^下一步$/], 7000).catch(() => {});
    await page.waitForTimeout(2000);
    await dismissDetectionPanel(page);
    await clickFirstVisible(page, [/^下一步$/], 5000).catch(() => {});
    while (!publishResponse && Date.now() < deadline) {
      const handledDetectionChoice = await page.evaluate(() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          return element.offsetParent !== null && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .arco-modal, div[class*="modal"]')).filter(visible);
        const dialog = dialogs.find((element) => (element.textContent || '').includes('请选择内容检测方式')); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        if (!dialog) return false;
        const button = Array.from(dialog.querySelectorAll('button')).find((element) => {
          const text = (element.textContent || '').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          return text === '仅基础检测' || text === '基础检测';
        }) || Array.from(dialog.querySelectorAll('button')).find((element) => (element.textContent || '').includes('全面检测')); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }).catch(() => false);
      if (handledDetectionChoice) {
        await page.waitForTimeout(1200);
        continue;
      }

      const typoDialog = page.locator('.arco-modal.auto-editor-error-modal.publish-modal-confirm').first();
      if (await typoDialog.isVisible({ timeout: 600 }).catch(() => false)) {
        await clickVisibleModalButton(page, '.arco-modal.auto-editor-error-modal.publish-modal-confirm', '提交').catch(() => {});
        await page.waitForTimeout(800);
        continue;
      }

      const confirmDialog = page.locator('.arco-modal.publish-confirm-container-new, [role="dialog"], div[class*="modal"]').first();
      if (await confirmDialog.isVisible({ timeout: 600 }).catch(() => false)) {
        await chooseNoAiInPublishDialog(page);
      }

      await clickFirstVisible(page, [/^确认发布$/, /^确认提交$/, /^发布$/, /^提交$/, /^确定$/, /^下一步$/], 1500).catch(() => {});
      await page.waitForTimeout(800);
    }
  } finally {
    page.off('response', onResponse);
  }

  if (!publishResponse) {
    const debug = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      buttons: Array.from(document.querySelectorAll('button, a'))
        .map((item) => ({
          text: (item.textContent || '').trim(), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          tag: item.tagName,
          className: String(item.className || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          disabled: Boolean(item.disabled),
          visible: Boolean(item.offsetParent),
        }))
        .filter((item) => item.text),
      bodyPreview: (document.body?.innerText || '').slice(0, 2000), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    })).catch(() => ({ url: page.url() }));
    throw new Error(`未捕获到番茄发布接口 publish_article；url=${debug.url}; buttons=${JSON.stringify(debug.buttons || []).slice(0, 1000)}`); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  }
  await page.waitForTimeout(5000);
  return publishResponse;
}

async function chooseNoAiInPublishDialog(page) {
  // 发布设置弹窗中默认选择“不使用 AI”之类的否定项，避免发布流程卡住。
  await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      return element.offsetParent !== null && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .arco-modal, div[class*="modal"]')).filter(visible);
    const dialog = dialogs.find((element) => (element.textContent || '').includes('发布设置')) || dialogs[0]; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    if (!dialog) return false;
    const labels = Array.from(dialog.querySelectorAll('label'));
    const noLabel = labels.find((element) => (element.textContent || '').trim() === '否') // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
      || labels.find((element) => (element.textContent || '').includes('否')); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    if (noLabel) {
      noLabel.click();
      return true;
    }
    const radio = Array.from(dialog.querySelectorAll('input[type="radio"]')).at(-1);
    if (radio) {
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }).catch(() => false);
  await page.waitForTimeout(500);
}

async function dismissDetectionPanel(page) {
  // 番茄编辑器点击"下一步"后可能触发内容检测，结果以内联面板显示，
  // 需要点击"知道了"关闭面板后才能继续。
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a, span, div'));
    const gotIt = btns.find((b) => /^(知道了|我知道了)$/.test(b.textContent?.trim()) && b.offsetParent !== null);
    if (gotIt) gotIt.click();
  }).catch(() => {});
  await page.waitForTimeout(500);
}

async function clickFirstVisible(page, patterns, timeoutMs) {
  // 在限定时间内寻找第一个可见可点击的按钮/链接。
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    for (const pattern of patterns) {
      const button = page.locator('button, a').filter({ hasText: pattern }).first();
      try {
        if (await button.count() && await button.isVisible({ timeout: 500 }).catch(() => false) && await button.isEnabled().catch(() => true)) {
          await button.click({ timeout: 3000, force: true });
          return;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(300);
  }
  throw lastError || new Error(`未找到可点击按钮: ${patterns.map(String).join(', ')}`);
}

async function clickVisibleModalButton(page, modalSelector, buttonText) {
  // 在指定弹窗中点击精确文案按钮，用于处理错别字确认等 modal。
  const clicked = await page.evaluate(({ modalSelector, buttonText }) => {
    const modal = Array.from(document.querySelectorAll(modalSelector)).find((element) => {
      return element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null;
    });
    if (!modal) return false;
    const button = Array.from(modal.querySelectorAll('button')).find((element) => (element.textContent || '').trim() === buttonText); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    if (!button) return false;
    button.click();
    return true;
  }, { modalSelector, buttonText });
  if (!clicked) throw new Error(`未找到弹窗按钮: ${buttonText}`);
}

async function closePopups(page) {
  // 清理常见遮挡弹窗，避免它们挡住作品列表或发布按钮。
  await page.evaluate(() => {
    const closeElements = document.querySelectorAll('[class*="close"], [aria-label*="close"]');
    for (const element of Array.from(closeElements)) {
      if (element instanceof HTMLElement) element.click();
    }
    const texts = ['知道了', '我知道了', 'Accept', '确定', '关闭'];
    for (const button of Array.from(document.querySelectorAll('button'))) {
      if (texts.some((text) => button.textContent?.includes(text)) && button instanceof HTMLElement) { // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        button.click();
      }
    }
  }).catch(() => {});
}

async function publishChapter(runtime, input) {
  // 单章发布的主流程：打开新建页 -> 填表 -> 提交 -> 回读远端章节列表确认。
  const { page, account, acceptanceDir } = runtime;
  const work = await openCreateChapterPage(page, input.bookId);
  const latestBefore = Number(work.latestChapterNumber || 0);
  // 原子发布不判断“该不该发布”；这里只强制平台章节连续，防止选中的
  // 本地章节被发到错误的远端章节槽位。
  if (input.enforceContinuity !== false && Number(input.chapterNumber) !== latestBefore + 1) {
    throw new Error(`章节不连续，番茄最新: ${latestBefore}，待发布: ${input.chapterNumber}`);
  }

  const form = await fillChapterForm(page, input);
  const beforeSubmitUrl = page.url();
  try {
    await submitPublish(page);
  } catch (error) {
    const tag = `${sanitizeFilePart(account.id)}-${sanitizeFilePart(input.bookId)}-${sanitizeFilePart(input.chapterNumber)}-${Date.now()}`;
    const screenshotPath = path.join(acceptanceDir, `failed-submit-${tag}.png`);
    const statePath = path.join(acceptanceDir, `failed-submit-${tag}.json`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const debug = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      buttons: Array.from(document.querySelectorAll('button, a'))
        .map((item) => ({
          text: (item.textContent || '').trim(), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          tag: item.tagName,
          className: item.className || '', // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
          disabled: Boolean(item.disabled),
          visible: Boolean(item.offsetParent),
        }))
        .filter((item) => item.text),
      bodyPreview: (document.body?.innerText || '').slice(0, 2000), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    })).catch(() => ({ url: page.url() }));
    fs.writeFileSync(statePath, JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      debug,
      screenshotPath,
    }, null, 2), 'utf8');
    throw new Error(`${error instanceof Error ? error.message : String(error)}; debug=${statePath}`);
  }

  const chapters = await listRemoteChapters(page, input.bookId);
  // 发布确认必须回到同一个 bookId 的章节列表里查；请求的章节号必须出现在
  // 这个远端列表中，才算成功。
  const matched = chapters.find((chapter) => Number(chapter.chapterNumber || 0) === Number(input.chapterNumber)) || null;
  const confirmed = Boolean(matched);
  const tag = `${sanitizeFilePart(account.id)}-${sanitizeFilePart(input.bookId)}-${sanitizeFilePart(input.chapterNumber)}-${Date.now()}`;
  const screenshotPath = path.join(acceptanceDir, `publish-${tag}.png`);
  const statePath = path.join(acceptanceDir, `publish-${tag}.json`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const result = {
    success: confirmed,
    accountId: account.id,
    bookId: String(input.bookId),
    chapterNumber: Number(input.chapterNumber),
    title: String(input.title),
    work,
    latestBefore,
    matchedChapter: matched,
    confirmed,
    beforeSubmitUrl,
    finalUrl: page.url(),
    wordCount: form.wordCount,
    screenshotPath,
    statePath,
  };
  fs.writeFileSync(statePath, JSON.stringify({
    ...result,
    chapters,
  }, null, 2), 'utf8');
  if (!confirmed) {
    throw new Error(`发布提交后未在远端章节列表确认第 ${input.chapterNumber} 章`);
  }
  return result;
}

async function main() {
  // CLI 分发入口。driver 只依赖 JSON stdout/stderr，不读取进程内对象。
  const command = readArg('--command');
  if (command) {
    const accountId = readArg('--account');
    const runtime = await createRuntime(accountId, !process.argv.includes('--headed'));
    try {
      if (command === 'works-live') {
        const data = await listWorks(runtime.page);
        console.log(JSON.stringify({ success: true, data }, null, 2));
        return;
      }
      if (command === 'remote-chapters') {
        const bookId = readArg('--book-id');
        if (!bookId) throw new Error('missing --book-id');
        const data = await listRemoteChapters(runtime.page, bookId);
        console.log(JSON.stringify({ success: true, data }, null, 2));
        return;
      }
      throw new Error(`unsupported_command: ${command}`);
    } finally {
      await closeRuntime(runtime);
    }
  }

  const payloadFile = readArg('--payload-file');
  const stdinPayload = process.argv.includes('--payload-stdin');
  if (!payloadFile && !stdinPayload) throw new Error('missing --payload-file or --payload-stdin');
  const input = stdinPayload
    ? JSON.parse(await readStdin())
    : JSON.parse(fs.readFileSync(path.resolve(payloadFile), 'utf8'));
  const accountId = String(input.accountId || ''); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  const runtime = await createRuntime(accountId, input.headless !== false);
  try {
    const data = await publishChapter(runtime, input);
    console.log(JSON.stringify({ success: true, data }, null, 2));
  } finally {
    await closeRuntime(runtime);
  }
}

main().catch((error) => {
  // 所有失败都输出结构化 JSON，便于 ScriptFanqiePlatformDriver 解析并转换为服务错误。
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});

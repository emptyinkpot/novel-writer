import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import {
  cleanBrowserLocks,
  ensureHeadfulSupported,
  extractCookieIdentity,
  getAcceptanceDir,
  loadDefaultRuntimeEnv,
  persistDatabaseCookies,
  resolveBrowserExecutable,
  sanitizeFilePart,
} from './fanqie-runtime.mjs';

const LOGIN_URL = 'https://fanqienovel.com/main/writer/login';
const BOOK_MANAGE_URL = 'https://fanqienovel.com/main/writer/book-manage';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const rootDir = process.env.FANQIE_SERVICE_ROOT || process.cwd();
const timeoutMs = readNumberArg('--timeout-ms', DEFAULT_TIMEOUT_MS);
const profileDir = readArg('--profile-dir') || createDiscoveryProfileDir();
const keepProfile = process.argv.includes('--keep-profile');
const executablePath = resolveBrowserExecutable();
const acceptanceDir = path.join(getAcceptanceDir(rootDir), 'login-discovery');
const logPath = path.join(acceptanceDir, `login-discovery-${Date.now()}.jsonl`);

fs.mkdirSync(acceptanceDir, { recursive: true });

let context = null;
let page = null;
const startedAt = new Date().toISOString();

try {
  logStep('start', {
    profileDir,
    timeoutMs,
    keepProfile,
    logPath,
  });
  ensureHeadfulSupported();
  loadDefaultRuntimeEnv();
  cleanBrowserLocks(profileDir);
  logStep('browser_launch', { executablePath });
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath,
    viewport: { width: 1400, height: 850 },
    args: ['--no-sandbox', '--window-size=1400,850', '--test-type'],
  });
  page = context.pages()[0] || await context.newPage();
  logStep('login_page_open', { url: LOGIN_URL });
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  logStep('waiting_for_login', { targetUrl: BOOK_MANAGE_URL });
  const state = await waitForLoggedInPage(page, context, timeoutMs);
  logStep('login_detected', {
    url: state.url,
    workCount: state.workCount,
    title: state.title,
  });

  const cookies = await context.cookies([
    'https://fanqienovel.com',
    'https://fanqienovel.com/main/writer/book-manage',
    'https://sso.toutiao.com',
    'https://www.toutiao.com',
    'https://bytedance.com',
    'https://www.bytedance.com',
  ]);
  const filteredCookies = filterFanqieCookies(cookies);
  if (filteredCookies.length === 0) {
    throw new Error('登录后未采集到番茄/头条 SSO cookie');
  }
  const cookieChecksum = hashJson(filteredCookies);
  logStep('cookies_extracted', {
    cookieCount: filteredCookies.length,
    cookieChecksumPrefix: cookieChecksum.slice(0, 12),
  });

  const identity = buildIdentity(state, filteredCookies);
  const accountId = `fanqie_${identity.uidHash.slice(0, 16)}`;
  const account = {
    id: accountId,
    name: state.accountName || accountId,
    aliases: state.accountName ? [state.accountName] : [],
    identity,
    meta: {
      loginDiscovery: {
        script: 'fanqie-account-login.mjs',
        startedAt,
        detectedAt: new Date().toISOString(),
        pageUrl: state.url,
        title: state.title,
        workCount: state.workCount,
      },
    },
  };
  logStep('account_identified', {
    accountId,
    accountName: account.name,
    uidHash: identity.uidHash,
    sessionHashPrefix: identity.sessionHash ? identity.sessionHash.slice(0, 12) : null,
  });

  logStep('database_write_started', { accountId, cookieCount: filteredCookies.length });
  const persistedCount = await persistDatabaseCookies(account, filteredCookies);
  logStep('database_write_finished', { accountId, persistedCount });

  const evidence = {
    script: 'fanqie-account-login.mjs',
    accountId,
    accountName: account.name,
    uidHash: identity.uidHash,
    cookieCount: filteredCookies.length,
    cookieChecksum,
    page: state,
    savedAt: new Date().toISOString(),
  };
  const evidencePath = path.join(acceptanceDir, `${sanitizeFilePart(accountId)}-${Date.now()}.json`);
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  logStep('evidence_written', { evidencePath });

  await context.close();
  context = null;
  logStep('browser_closed', {});
  if (!keepProfile) {
    await fs.promises.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    logStep('profile_removed', { profileDir });
  }

  const result = {
    success: true,
    accountId,
    accountName: account.name,
    status: 'completed',
    headed: true,
    cookieCount: filteredCookies.length,
    cookieChecksum,
    evidencePath,
    logPath,
  };
  logStep('done', {
    accountId,
    status: result.status,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  logStep('error', {
    message: error instanceof Error ? error.message : String(error),
  });
  if (context) {
    await context.close().catch(() => {});
    logStep('browser_closed', { reason: 'error' });
  }
  console.log(JSON.stringify({
    success: false,
    status: 'failed',
    headed: true,
    logPath,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}

async function waitForLoggedInPage(page, context, timeoutMs) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    lastState = await readPageState(page);
    if (isLoggedInState(lastState)) return lastState;
    const cookies = await context.cookies([
      'https://fanqienovel.com',
      'https://sso.toutiao.com',
      'https://www.toutiao.com',
      'https://bytedance.com',
      'https://www.bytedance.com',
    ]).catch(() => []);
    const identity = extractCookieIdentity(cookies);
    if (identity.uid && identity.session) {
      logStep('login_cookie_detected', { uidHash: hashText(identity.uid), currentUrl: lastState.url });
      await page.goto(BOOK_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);
      lastState = await readPageState(page);
      if (isLoggedInState(lastState)) return lastState;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error(`等待用户登录超时；最后页面=${lastState?.url || page.url()}`);
}

async function readPageState(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const accountName = findAccountName(text);
    return {
      url: window.location.href,
      title: document.title,
      workCount: document.querySelectorAll('[id^="long-article-table-item-"]').length,
      accountName,
      textPreview: text.slice(0, 500),
    };

    function findAccountName(pageText) {
      const candidates = [];
      for (const selector of [
        '[class*="avatar"]',
        '[class*="user"]',
        '[class*="author"]',
        '[class*="nickname"]',
        '[class*="name"]',
      ]) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          const value = (element.textContent || '').trim();
          if (value) candidates.push(value);
        }
      }
      const lines = pageText.split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines.slice(0, 40)) candidates.push(line);
      return candidates
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter((value) => value.length >= 2 && value.length <= 32)
        .filter((value) => !/作品|章节|数据|首页|消息|登录|扫码|创作|设置|番茄|提现|帮助|书架/.test(value))[0] || '';
    }
  }).catch(async () => ({
    url: page.url(),
    title: await page.title().catch(() => ''),
    workCount: await page.locator('[id^="long-article-table-item-"]').count().catch(() => 0),
    accountName: '',
    textPreview: '',
  }));
}

function isLoggedInState(state) {
  const url = String(state?.url || '');
  if (/\/main\/writer\/login/i.test(url)) return false;
  if (!/\/main\/writer\/book-manage/i.test(url)) return false;
  if (Number(state?.workCount || 0) > 0) return true;
  return /作品|书籍|创建|草稿|章节/.test(String(state?.textPreview || ''));
}

function buildIdentity(state, cookies) {
  const cookieIdentity = extractCookieIdentity(cookies);
  const uidHash = cookieIdentity.uid
    ? hashText(cookieIdentity.uid)
    : hashText(`${state.accountName || ''}:${hashJson(cookies)}`);
  return {
    provider: 'fanqie',
    displayName: state.accountName || null,
    uidHash,
    sessionHash: cookieIdentity.session ? hashText(cookieIdentity.session) : null,
    source: 'fanqie-service.login-discovery',
  };
}

function filterFanqieCookies(cookies) {
  return (Array.isArray(cookies) ? cookies : []).filter((cookie) => {
    const domain = String(cookie?.domain || '').toLowerCase();
    return /fanqie|toutiao|bytedance/.test(domain);
  });
}

function createDiscoveryProfileDir() {
  const baseDir = process.env.FANQIE_RUNTIME_BROWSER_ROOT
    || path.join(os.tmpdir(), 'fanqie-service-browser');
  return path.join(baseDir, `login-discovery-${Date.now().toString(36)}`);
}

function logStep(step, data = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    step,
    ...data,
  });
  try {
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch {}
  process.stderr.write(`${line}\n`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
}

function readNumberArg(name, fallback) {
  const value = Number(readArg(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function hashJson(value) {
  return hashText(JSON.stringify(value || null));
}

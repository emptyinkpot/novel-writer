import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createRuntimeDatabaseClient, findRepoRoot, resolveDataDir } from './local-store.mjs';

// 浏览器脚本的共享 runtime 工具。
// 这里统一负责：解析番茄账号（本地 data/publisher.sqlite）、定位浏览器、
// 管理 profile 锁、注入/回写 cookie、采集后台页面证据。
export function readJsonFile(filePath, fallback = null) { // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  if (!filePath || !fs.existsSync(filePath)) return fallback; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  }
}

function loadEnvFile(filePath) {
  // 只填充当前进程尚未设置的环境变量，避免覆盖调用方显式传入的配置。
  if (!filePath || !fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

let defaultEnvLoaded = false;

export function loadDefaultRuntimeEnv() {
  if (defaultEnvLoaded) return;
  defaultEnvLoaded = true;
  // 项目只认识自己：只读取仓库根目录的 .env。
  loadEnvFile(path.join(findRepoRoot(), '.env'));
}

/** publisher 运行时数据目录（profile、证据、截图）。 */
export function defaultServiceDataDir() {
  return process.env.FANQIE_SERVICE_DATA_DIR || path.join(resolveDataDir(), 'publisher');
}

function runtimeBrowserDirForAccount(accountId) {
  // profile 目录按账号隔离，避免多个番茄账号共用同一浏览器状态。
  const baseDir = process.env.FANQIE_RUNTIME_BROWSER_ROOT
    || path.join(defaultServiceDataDir(), 'browser-profiles');
  return path.join(baseDir, sanitizeLocalPart(accountId));
}

function sanitizeLocalPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function parseCookiePayload(value) {
  // 可复用 cookie payload 规范：
  // {
  //   "schemaVersion": 1,
  //   "kind": "fanqie.cookies",
  //   "accountId": "fanqie_xxx",
  //   "savedAt": "ISO time",
  //   "cookieCount": 28,
  //   "expiresSummary": {...},
  //   "cookies": [...]
  // }
  // 读取时兼容旧数组和旧 { cookies } 形态；写入只写上面的规范形态。
  const text = String(value || '').trim(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  if (!text) return { cookies: [], source: 'empty' };
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return { cookies: parsed, source: 'legacy-json-array' };
      if (Array.isArray(parsed?.cookies)) { // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
        return {
          cookies: parsed.cookies,
          source: parsed.kind === 'fanqie.cookies' ? `database-v${parsed.schemaVersion || 1}` : 'legacy-json-object',
        };
      }
    } catch {}
  }
  return { cookies: [], source: 'database-non-json' };
}

export async function resolveDatabaseAccount({ accountId }) {
  // 账号和 session cookie 存在本地 data/publisher.sqlite；
  // 浏览器 profile 只是运行时缓存，不能反向成为账号真源。
  loadDefaultRuntimeEnv();
  const payload = await createRuntimeDatabaseClient().publication.accounts({ limit: 500 });
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : []; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  const row = accountId
    ? accounts.find((item) => String(item?.accountId || item?.id || '') === String(accountId)) // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    : accounts[0];
  // 账号只由登录流程（recordFanqieAccountSession）建档。
  if (!row?.accountId && !row?.id) return null; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  const id = String(row.accountId || row.id);
  const session = row.session && typeof row.session === 'object' ? row.session : {};
  const cookieState = parseCookiePayload(session.cookiesPayload);
  return {
    id,
    name: String(row.name || id),
    browserDir: runtimeBrowserDirForAccount(id),
    cookies: cookieState.cookies,
    cookieSource: cookieState.source,
    cookieChecksum: row.cookieChecksum ? String(row.cookieChecksum) : null,
    expectedCookieCount: Number.isFinite(Number(session.cookieCount)) ? Number(session.cookieCount) : null,
    sessionSyncedAt: session.syncedAt ? new Date(session.syncedAt).toISOString() : null,
    accountSource: 'local',
  };
}

export async function resolveAccount(optionsOrConfig, projectsRoot, requestedId) {
  // 旧签名仍由调用方传入 projectsRoot/requestedId 时转成对象形态；
  // 最终仍只从 本地存储 resolve 账号。
  const options = projectsRoot
    ? {
      dataDir: process.env.FANQIE_SERVICE_DATA_DIR || path.join(projectsRoot, '.runtime', 'fanqie-service'),
      rootDir: process.env.FANQIE_SERVICE_ROOT || projectsRoot,
      contentBaseRoot: process.env.FANQIE_CONTENTBASE_ROOT || projectsRoot,
      accountId: requestedId,
    }
    : optionsOrConfig;
  const account = await resolveDatabaseAccount(options);
  if (!account) {
    throw new Error(`本地没有番茄账号: ${options.accountId || '(default)'}，需要先完成一次番茄登录`);
  }
  return account;
}

export function resolveBrowserExecutable() {
  // 优先使用显式环境变量；否则按常见 Edge/Chrome/Chromium 路径查找。
  const candidates = [
    process.env.FANQIE_BROWSER_EXECUTABLE,
    process.env.CONTENTBASE_BROWSER_EXECUTABLE,
    process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : null,
    process.platform === 'win32' ? 'C:/Program Files/Microsoft/Edge/Application/msedge.exe' : null,
    process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : null,
    process.platform === 'linux' ? '/usr/bin/microsoft-edge' : null,
    process.platform === 'linux' ? '/usr/bin/microsoft-edge-stable' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : null,
    chromium.executablePath(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('未找到可用的 Chromium/Chrome/Edge 可执行文件；请设置 FANQIE_BROWSER_EXECUTABLE');
}

export function hasHeadfulSupport() {
  // Linux 只有存在 DISPLAY/WAYLAND_DISPLAY 时才认为能打开有头浏览器。
  if (process.platform !== 'linux') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export function ensureHeadfulSupported() { // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  if (!hasHeadfulSupport()) {
    throw new Error('Linux 无图形会话，无法执行有头登录；请设置 DISPLAY/WAYLAND_DISPLAY');
  }
}

export function getAcceptanceDir(rootDir) {
  // acceptance 目录保存状态 JSON 和截图，作为浏览器执行证据。
  // 统一放在 data/publisher/acceptance，rootDir 参数保留兼容旧调用。
  return path.join(defaultServiceDataDir(), 'acceptance');
}

export function cleanBrowserLocks(browserDir) {
  // 清理 Chromium profile 锁文件；这些文件残留时会导致同 profile 无法启动。
  for (const fileName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'Lock', 'lockfile']) {
    try {
      fs.unlinkSync(path.join(browserDir, fileName));
    } catch {}
  }

  if (process.platform === 'linux') {
    const baseDir = path.join(os.homedir(), 'snap', 'chromium', 'common', 'chromium');
    for (const fileName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'Lock']) {
      try {
        fs.unlinkSync(path.join(baseDir, fileName));
      } catch {}
    }
  }
}

function escapeForPowerShellSingleQuote(value) {
  // PowerShell 单引号字符串中用两个单引号表示字面单引号。
  return String(value || '').replace(/'/g, "''"); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

export function listBrowserProcessesForProfile(browserDir) {
  // 只找命令行包含当前 profile 目录的浏览器进程，避免误杀用户其他窗口。
  if (process.platform === 'win32') {
    const escaped = escapeForPowerShellSingleQuote(browserDir);
    const script = [
      `$dir = '${escaped}'`,
      "$procs = Get-CimInstance Win32_Process | Where-Object {",
      "  $_.Name -match 'msedge|chrome|chromium' -and $_.CommandLine -like ('*' + $dir + '*')",
      "}",
      "$procs | ForEach-Object { $_.ProcessId }",
    ].join(' ');
    const result = spawnSync('powershell', ['-NoLogo', '-NoProfile', '-Command', script], { encoding: 'utf8' });
    return String(result.stdout || '').split(/\r?\n/).map((item) => Number.parseInt(item.trim(), 10)).filter(Number.isFinite); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  }

  const result = spawnSync('sh', ['-lc', `ps -eo pid=,command= | grep -F "${browserDir.replace(/"/g, '\\"')}" | grep -E 'msedge|chrome|chromium' | grep -v grep | awk '{print $1}'`], { encoding: 'utf8' });
  return String(result.stdout || '').split(/\r?\n/).map((item) => Number.parseInt(item.trim(), 10)).filter(Number.isFinite); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

export function killBrowserProcessesForProfile(browserDir) {
  // 登录或重试前清理占用同一 profile 的浏览器进程。
  const pids = listBrowserProcessesForProfile(browserDir);
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        spawnSync('cmd', ['/c', 'taskkill', '/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        spawnSync('kill', ['-TERM', String(pid)], { stdio: 'ignore' });
      }
    } catch {}
  }
  return pids;
}

export async function waitForProfileBrowserExit(browserDir, timeoutMs = 30 * 60 * 1000) {
  // --login --wait 用它等待操作员关闭登录窗口。
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (listBrowserProcessesForProfile(browserDir).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function cookiesForAccount(account) {
  if (Array.isArray(account?.cookies)) return account.cookies; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  return [];
}

export function extractCookieIdentity(cookies) {
  // 只抽取身份相关 cookie，用于诊断；不在日志中输出完整 cookie。
  const list = Array.isArray(cookies) ? cookies : [];
  const pick = (name) => list.find((item) => String(item?.name || '') === name)?.value || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  return {
    uid: String(pick('uid_tt') || pick('uid_tt_ss') || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    session: String(pick('sessionid') || pick('sessionid_ss') || pick('sid_tt') || ''), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  };
}

export function inspectLocalAccountState(account) {
  // 输出本地 profile/cookie 状态摘要，帮助区分账号缺失、cookie 缺失和 profile 缓存问题。
  const cookies = cookiesForAccount(account);
  const profileExists = Boolean(account.browserDir && fs.existsSync(account.browserDir));
  const profileEntries = profileExists
    ? fs.readdirSync(account.browserDir).filter((name) => !name.startsWith('Singleton')).length
    : 0;
  return {
    accountSource: account.accountSource || 'local',
    browserDir: account.browserDir,
    browserDirExists: profileExists,
    browserProfileEntryCount: profileEntries,
    cookieSource: account.cookieSource || 'database-json',
    localCookieCount: cookies.length,
    expectedCookieCount: account.expectedCookieCount ?? null, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    sessionSyncedAt: account.sessionSyncedAt || null,
    cookieCountMatchesExpected: account.expectedCookieCount == null ? null : cookies.length === account.expectedCookieCount,
  };
}

export async function hydrateContextFromCookieBackup(context, account) {
  // 打开浏览器后把 本地存储 cookie 注入 context，避免依赖本地 profile 是否还在。
  // 但只补磁盘 profile 缺失的；磁盘里已有的（通常是用户刚登录留下的新 cookie）必须保留，
  // 否则会用 本地存储 旧 cookie 覆盖新 cookie，导致登录态被刷回过期状态。
  const backup = cookiesForAccount(account);
  if (!backup.length) return 0;
  const existing = await context.cookies().catch(() => []);
  const existingKeys = new Set(
    (Array.isArray(existing) ? existing : []).map(
      (c) => `${c?.name || ''} ${c?.domain || ''} ${c?.path || '/'}`,
    ),
  );
  const toAdd = backup.filter((c) => {
    const key = `${c?.name || ''} ${c?.domain || ''} ${c?.path || '/'}`;
    return !existingKeys.has(key);
  });
  if (!toAdd.length) return 0;
  await context.addCookies(toAdd);
  return toAdd.length;
}

function cookieChecksum(cookies) {
  // checksum 用于 本地存储 侧判断 cookie 内容是否变化。
  return createHash('sha256').update(JSON.stringify(cookies || [])).digest('hex'); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
}

function expiresSummary(cookies) {
  // 保存 cookie 域名和过期时间摘要，避免排障时必须展开完整 cookie。
  const list = Array.isArray(cookies) ? cookies : [];
  const expiresValues = list
    .map((item) => Number(item?.expires || 0)) // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    domains: [...new Set(list.map((item) => String(item?.domain || '')).filter(Boolean))].sort(), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
    cookieCount: list.length,
    maxExpires: expiresValues.length ? Math.max(...expiresValues) : null,
    sessionCookieCount: list.length - expiresValues.length,
  };
}

function createCookiePayload(account, cookies) {
  const summary = expiresSummary(cookies);
  return {
    schemaVersion: 1,
    kind: 'fanqie.cookies',
    accountId: account.id,
    savedAt: new Date().toISOString(),
    cookieCount: cookies.length,
    checksum: cookieChecksum(cookies),
    expiresSummary: summary,
    cookies,
  };
}

export async function persistDatabaseCookies(account, cookies) {
  // 登录态采集成功后，把浏览器 context 中的新 cookie 回写到 本地存储。
  const payload = createCookiePayload(account, cookies);
  const checksum = cookieChecksum(cookies);
  const input = {
    accountId: account.id,
    accountName: account.name,
    aliases: Array.isArray(account.aliases) ? account.aliases : undefined,
    identity: account.identity && typeof account.identity === 'object' ? account.identity : undefined,
    meta: account.meta && typeof account.meta === 'object' ? account.meta : undefined,
    cookiesPayload: payload,
    cookieChecksum: checksum,
    cookieCount: cookies.length,
    expiresSummary: payload.expiresSummary,
  };
  await createRuntimeDatabaseClient().publication.recordFanqieAccountSession(
    input,
    {
      idempotencyKey: `fanqie-service:cookie:${account.id}:${checksum}`,
      requestId: `fanqie_cookie_${Date.now().toString(36)}`,
    },
  );
    account.cookies = cookies;
    account.cookieSource = 'database-json';
    account.cookieChecksum = checksum;
    account.expectedCookieCount = cookies.length;
    account.sessionSyncedAt = new Date().toISOString();
    return cookies.length;
}

export async function persistContextCookies(context, account) {
  // 只收集番茄和头条 SSO 域名下的 cookie，避免把无关浏览器状态写入 本地存储。
  const cookies = await context.cookies([
    'https://fanqienovel.com',
    'https://fanqienovel.com/main/writer/book-manage',
    'https://sso.toutiao.com',
    'https://www.toutiao.com',
  ]);
  if (!Array.isArray(cookies) || !cookies.length) return 0;
  return persistDatabaseCookies(account, cookies);
}

export async function captureBookManageState({ account, executablePath, acceptanceDir, headless, tag }) {
  // 打开番茄作者后台并采集页面状态；状态 JSON 和截图是 session 检查的验收证据。
  fs.mkdirSync(acceptanceDir, { recursive: true });
  cleanBrowserLocks(account.browserDir);
  const context = await chromium.launchPersistentContext(account.browserDir, {
    headless,
    executablePath,
    viewport: { width: 1400, height: 850 },
    args: ['--no-sandbox', '--window-size=1920,1080', '--test-type'],
  });
  const page = context.pages()[0] || await context.newPage();
  await hydrateContextFromCookieBackup(context, account).catch(() => {});
  let error = null;
  try {
    await page.goto('https://fanqienovel.com/main/writer/book-manage', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    await page.waitForLoadState('load').catch(() => {});
  } catch (err) {
    error = err?.message || String(err); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  }

  const data = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    workCount: document.querySelectorAll('[id^="long-article-table-item-"]').length,
    textPreview: (document.body?.innerText || '').slice(0, 500), // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  })).catch(async () => ({
    url: page.url(),
    title: await page.title().catch(() => ''),
    workCount: await page.locator('[id^="long-article-table-item-"]').count().catch(() => 0),
    textPreview: await page.locator('body').innerText().then((text) => text.slice(0, 500)).catch(() => ''),
  }));

  const payload = {
    accountId: account.id,
    accountName: account.name,
    headless,
    localState: inspectLocalAccountState(account),
    ...data,
    error,
  };
  const fileBase = `${sanitizeFilePart(account.id)}-${sanitizeFilePart(tag)}`;
  const statePath = path.join(acceptanceDir, `${fileBase}-state.json`);
  const screenshotPath = path.join(acceptanceDir, `${fileBase}.png`);
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  if (isUsableBookManageState(payload)) {
    try {
      payload.cookiePersistedCount = await persistContextCookies(context, account);
    } catch (persistError) {
      payload.cookiePersistError = persistError instanceof Error ? persistError.message : String(persistError);
    }
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8');
  }
  await context.close();
  return { ...payload, statePath, screenshotPath };
}

function isUsableBookManageState(payload) {
  // 能看到作品列表才认为 session 可用；登录页或空列表都不能当作有效登录态。
  const url = String(payload?.url || ''); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  const workCount = Number(payload?.workCount || 0); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  if (/\/main\/writer\/login/i.test(url)) return false;
  return workCount > 0;
}

export function sanitizeFilePart(value) {
  // 用于证据文件名，避免账号/标签里的特殊字符破坏路径。
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

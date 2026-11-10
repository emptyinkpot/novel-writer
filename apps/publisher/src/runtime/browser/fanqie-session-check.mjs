import { spawn } from 'node:child_process';
import {
  captureBookManageState,
  cleanBrowserLocks,
  ensureHeadfulSupported, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  extractCookieIdentity,
  listBrowserProcessesForProfile,
  getAcceptanceDir,
  hasHeadfulSupport,
  killBrowserProcessesForProfile,
  resolveAccount,
  resolveBrowserExecutable,
  waitForProfileBrowserExit,
  defaultServiceDataDir,
} from './fanqie-runtime.mjs';
import { extractAndPersistProfileCookies, readProfileCookies } from './extract-profile-cookies.mjs';

// session-check 是账号登录态的浏览器入口：
// - 普通模式：用 本地存储 中的 cookie/profile 打开番茄后台并采集状态。
// - --quick：只跑 headless，不弹窗口；供发布前的自动检查和后台巡检使用。
// - --login：打开有头浏览器，让操作员手动完成登录。
//   加 --wait 时会轮询 profile cookie，检测到新的登录态后校验账号身份、写回本地存储并自动关窗。
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const accountId = positionalArgs[0] || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
const loginMode = process.argv.includes('--login');
const waitForExit = process.argv.includes('--wait');
const quickMode = process.argv.includes('--quick');
const LOGIN_TIMEOUT_MS = Number(process.env.FANQIE_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);
const LOGIN_POLL_MS = 3000;
const dataDir = defaultServiceDataDir();
const rootDir = process.env.FANQIE_SERVICE_ROOT || process.cwd();
const contentBaseRoot = process.env.FANQIE_CONTENTBASE_ROOT || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
const account = await resolveAccount({ dataDir, rootDir, contentBaseRoot, accountId });
const executablePath = resolveBrowserExecutable();
const acceptanceDir = getAcceptanceDir(rootDir);

if (loginMode) {
  // 登录必须使用有头浏览器；同一个 profile 启动前先清理残留锁和进程，
  // 避免 Chrome/Edge 的 ProcessSingleton 阻止窗口打开。
  ensureHeadfulSupported(); // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  killBrowserProcessesForProfile(account.browserDir);
  cleanBrowserLocks(account.browserDir);

  const stored = extractCookieIdentity(account.cookies);
  const profileBefore = extractCookieIdentity(await readProfileCookies(account).catch(() => []));
  const baseline = {
    uid: stored.uid || profileBefore.uid,
    storedSession: stored.session,
    profileSession: profileBefore.session,
  };

  const browser = spawn(executablePath, [
    `--user-data-dir=${account.browserDir}`,
    '--new-window',
    '--window-size=1400,850',
    'https://fanqienovel.com/main/writer/book-manage',
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });

  browser.unref();
  if (!waitForExit) {
    console.log(JSON.stringify({
      success: true,
      accountId: account.id,
      accountName: account.name,
      status: 'started',
      headed: true,
      message: '已打开番茄登录窗口',
      pid: browser.pid,
    }, null, 2));
    process.exit(0);
  }

  const outcome = await waitForLogin(account, baseline);
  // 登录结束后关掉窗口，释放 profile，后续 headless 校验和发布才能用同一个 profile。
  killBrowserProcessesForProfile(account.browserDir);
  cleanBrowserLocks(account.browserDir);

  console.log(JSON.stringify({
    success: true,
    accountId: account.id,
    accountName: account.name,
    headed: true,
    ...outcome,
    acceptanceDir,
  }, null, 2));
  process.exit(0);
}

/**
 * 等待操作员在窗口里完成登录。
 * 判定：profile 里出现了与登录前不同的 session cookie。
 * 身份：新 cookie 的 uid 必须与该账号原有 uid 一致，否则拒绝写入，避免串号。
 */
async function waitForLogin(account, baseline) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let supported = true;
  while (Date.now() < deadline) {
    await sleep(LOGIN_POLL_MS);
    const windowOpen = listBrowserProcessesForProfile(account.browserDir).length > 0;
    const cookies = supported ? await readProfileCookies(account).catch(() => []) : null;
    if (cookies === null) supported = false;
    if (cookies && cookies.length) {
      const identity = extractCookieIdentity(cookies);
      const isNewSession = identity.session && identity.uid
        && identity.session !== baseline.profileSession
        && identity.session !== baseline.storedSession;
      if (isNewSession) {
        if (baseline.uid && identity.uid !== baseline.uid) {
          return { status: 'identity_mismatch', expectedUid: mask(baseline.uid), actualUid: mask(identity.uid), message: '登录的番茄账号和原账号不一致，已拒绝写入' };
        }
        const saved = await extractAndPersistProfileCookies(account, cookies);
        return { status: 'completed', cookieCount: saved?.cookieCount ?? cookies.length, uid: mask(identity.uid), message: '已检测到登录，cookie 已更新' };
      }
    }
    if (!windowOpen) {
      if (!supported) {
        // 非 Windows 无法在窗口打开期间读 cookie：以关窗为完成信号，交给后续校验判断是否真的登录。
        return { status: 'completed', message: '登录窗口已关闭，等待校验' };
      }
      return { status: 'cancelled', message: '登录窗口被关闭，未检测到新的登录' };
    }
  }
  return { status: 'timeout', message: `等待登录超时（${Math.round(LOGIN_TIMEOUT_MS / 60000)} 分钟）` };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mask(uid) {
  const text = String(uid || '');
  return text.length <= 6 ? text : `${text.slice(0, 3)}***${text.slice(-3)}`;
}

// 校验模式优先跑 headless；如果当前机器有图形会话，再补一次 headed，
// 这样能区分“cookie 真失效”和“headless 环境差异”。
const results = [];
results.push(await captureBookManageState({
  account,
  executablePath,
  acceptanceDir,
  headless: true,
  tag: 'session-check-headless',
}));

if (!quickMode && hasHeadfulSupport()) {
  results.push(await captureBookManageState({
    account,
    executablePath,
    acceptanceDir,
    headless: false,
    tag: 'session-check-headed',
  }));
} else {
  results.push({
    accountId: account.id,
    accountName: account.name,
    headless: false,
    skipped: true,
    skipReason: quickMode ? 'quick 模式只做 headless 检查' : 'Linux 无图形会话，已跳过 headed 检查',
  });
}

console.log(JSON.stringify(results, null, 2));

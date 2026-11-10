import { spawn } from 'node:child_process';
import {
  captureBookManageState,
  cleanBrowserLocks,
  ensureHeadfulSupported, // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
  getAcceptanceDir,
  hasHeadfulSupport,
  killBrowserProcessesForProfile,
  resolveAccount,
  resolveBrowserExecutable,
  waitForProfileBrowserExit,
} from './fanqie-runtime.mjs';
import { extractAndPersistProfileCookies } from './extract-profile-cookies.mjs';

// session-check 是账号登录态的浏览器入口：
// - 普通模式：用 DataBase 中的 cookie/profile 打开番茄后台并采集状态。
// - --login：打开有头浏览器，让操作员手动完成登录。
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const accountId = positionalArgs[0] || ''; // defensive-code-allow: external Fanqie/DataBase/browser boundary contract.
const loginMode = process.argv.includes('--login');
const waitForExit = process.argv.includes('--wait');
const dataDir = process.env.FANQIE_SERVICE_DATA_DIR || '.runtime/fanqie-service';
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
  const completed = waitForExit ? await waitForProfileBrowserExit(account.browserDir) : false;

  // 登录完成后自动提取 cookies 并持久化到 DataBase Gateway
  let extractResult = null;
  if (completed) {
    extractResult = await extractAndPersistProfileCookies(account).catch((e) => ({ error: e.message }));
  }

  console.log(JSON.stringify({
    success: true,
    accountId: account.id,
    accountName: account.name,
    status: completed ? 'completed' : 'started',
    headed: true,
    message: waitForExit
      ? '番茄登录窗口已关闭，cookies 已自动提取并持久化'
      : '已打开番茄登录窗口，请在真实浏览器中完成登录后关闭窗口，再返回执行校验',
    extractResult,
    acceptanceDir,
    pid: browser.pid,
  }, null, 2));
  process.exit(0);
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

if (hasHeadfulSupport()) {
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
    skipReason: 'Linux 无图形会话，已跳过 headed 检查',
  });
}

console.log(JSON.stringify(results, null, 2));

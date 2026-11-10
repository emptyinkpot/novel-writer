import { FanqieServiceError } from '../../sdk/errors.js';
import type {
  EditChapterResult,
  EditRemoteChapterInput,
  LoginOptions,
  LoginResult,
  PlatformConfirmationEvidence,
  PublishChapterInput,
  RemoteChapterDetail,
  RemoteChapterSnapshot,
  RemoteWorkSnapshot,
  ScanWorksInput,
  SessionCheckOptions,
  SessionCheckResult,
  SyncRemoteChaptersInput,
} from '../../sdk/types.js';
import type { FanqiePlatformDriver } from './FanqiePlatformDriver.js';

export type AccountSessionStatus = 'valid' | 'expired' | 'missing' | 'unknown' | 'waiting_login' | 'login_failed';

export interface AccountSessionState {
  accountId: string;
  status: AccountSessionStatus;
  checkedAt?: string;
  message?: string;
}

export interface SessionGuardOptions {
  /** 校验通过后多长时间内不再重复检查。 */
  cacheMs?: number;
  /** 过期时是否自动打开登录窗口；关闭后直接报 fanqie_login_required。 */
  autoRelogin?: boolean;
  log?: (message: string) => void;
}

/**
 * 番茄登录态守卫。所有需要登录的操作都经过这里：
 *   1. 执行前快速检查（headless，不弹窗；结果缓存一段时间）；
 *   2. 已过期 → 打开登录窗口，等待登录并确认 cookie 已更新；
 *   3. 执行中失败 → 复查登录态，确认是过期导致的，就重新登录后重试一次。
 * 同一账号同时只开一个登录窗口，并发任务共享这一次登录。
 * 网络错误等无法判定的情况（unknown）不会触发登录。
 */
export class SessionGuardedFanqieDriver implements FanqiePlatformDriver {
  readonly configured: boolean;
  readonly name: string;

  private readonly cacheMs: number;
  private readonly autoRelogin: boolean;
  private readonly log: (message: string) => void;
  private readonly validUntil = new Map<string, number>();
  private readonly pendingLogins = new Map<string, Promise<void>>();
  private readonly states = new Map<string, AccountSessionState>();

  constructor(private readonly inner: FanqiePlatformDriver, options: SessionGuardOptions = {}) {
    this.configured = inner.configured;
    this.name = inner.name;
    this.cacheMs = options.cacheMs ?? 10 * 60 * 1000;
    this.autoRelogin = options.autoRelogin ?? true;
    this.log = options.log ?? ((message) => console.log(`[session-guard] ${message}`));
  }

  // ---- 状态查询 ----

  getState(accountId: string): AccountSessionState {
    return this.states.get(accountId) ?? { accountId, status: 'unknown' };
  }

  listStates(): AccountSessionState[] {
    return [...this.states.values()];
  }

  /** 后台巡检用：只检查并记录状态，从不打开窗口。 */
  async refreshState(accountId: string): Promise<AccountSessionState> {
    if (this.pendingLogins.has(accountId)) return this.getState(accountId);
    const result = await this.check(accountId, true);
    return this.getState(result.accountId);
  }

  // ---- 透传 ----

  login(accountId: string, options?: LoginOptions): Promise<LoginResult> {
    return this.inner.login(accountId, options);
  }

  loginDiscovered(): Promise<LoginResult> {
    return this.inner.loginDiscovered();
  }

  async checkSession(accountId: string, options?: SessionCheckOptions): Promise<SessionCheckResult> {
    const result = await this.inner.checkSession(accountId, options);
    this.record(result);
    return result;
  }

  // ---- 需要登录态的操作 ----

  scanWorks(input: ScanWorksInput): Promise<RemoteWorkSnapshot[]> {
    if (!input.accountId) return this.inner.scanWorks(input);
    return this.guard(input.accountId, () => this.inner.scanWorks(input));
  }

  syncRemoteChapters(input: SyncRemoteChaptersInput): Promise<RemoteChapterSnapshot[]> {
    return this.guard(input.accountId, () => this.inner.syncRemoteChapters(input));
  }

  publishChapter(input: PublishChapterInput): Promise<PlatformConfirmationEvidence> {
    return this.guard(input.accountId, () => this.inner.publishChapter(input));
  }

  getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail> {
    return this.guard(input.accountId, () => this.inner.getRemoteChapter(input));
  }

  editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult> {
    return this.guard(input.accountId, () => this.inner.editRemoteChapter(input));
  }

  // ---- 核心逻辑 ----

  /** 确保账号已登录：必要时打开登录窗口并等待。供 reauth 和 guard 共用。 */
  async ensureSession(accountId: string, force = false): Promise<void> {
    if (!force && (this.validUntil.get(accountId) ?? 0) > Date.now()) return;
    const result = await this.check(accountId, true);
    if (result.status === 'valid' || result.status === 'unknown') return;
    if (result.status === 'missing') {
      throw new FanqieServiceError('fanqie_account_missing', `本地没有番茄账号 ${accountId}，需要先完成一次番茄登录`, 404, result);
    }
    await this.relogin(accountId);
  }

  private async guard<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    await this.ensureSession(accountId);
    try {
      return await operation();
    } catch (error) {
      if (!isDriverFailure(error)) throw error;
      // 操作失败后复查：只有确认是登录态过期才重登重试，其他失败原样抛出。
      this.validUntil.delete(accountId);
      const recheck = await this.check(accountId, true).catch(() => null);
      if (!recheck || recheck.status !== 'expired') throw error;
      this.log(`${accountId} 操作中途登录态失效，重新登录后重试一次`);
      await this.relogin(accountId);
      return operation();
    }
  }

  private relogin(accountId: string): Promise<void> {
    const pending = this.pendingLogins.get(accountId);
    if (pending) return pending;
    const task = this.doRelogin(accountId).finally(() => this.pendingLogins.delete(accountId));
    this.pendingLogins.set(accountId, task);
    return task;
  }

  private async doRelogin(accountId: string): Promise<void> {
    this.validUntil.delete(accountId);
    if (!this.autoRelogin) {
      this.setState(accountId, 'expired', '登录态已失效，自动登录已关闭');
      throw new FanqieServiceError('fanqie_login_required', `番茄账号 ${accountId} 登录态已失效`, 401);
    }
    this.setState(accountId, 'waiting_login', '已打开番茄登录窗口，等待登录');
    this.log(`${accountId} 登录态失效，已打开登录窗口，等待登录`);
    let login: LoginResult;
    try {
      login = await this.inner.login(accountId, { waitForCompletion: true });
    } catch (error) {
      this.setState(accountId, 'login_failed', error instanceof Error ? error.message : String(error));
      throw new FanqieServiceError('fanqie_login_failed', `无法打开番茄登录窗口：${error instanceof Error ? error.message : String(error)}`, 503);
    }
    if (login.status !== 'completed') {
      const message = loginFailureMessage(login.reason);
      this.setState(accountId, 'login_failed', message);
      throw new FanqieServiceError(`fanqie_login_${login.reason || 'failed'}`, message, 401, login.evidence);
    }
    // 以真实页面校验为准，确认新 cookie 确实可用。
    const after = await this.check(accountId, true);
    if (after.status !== 'valid') {
      this.setState(accountId, 'login_failed', '登录后校验未通过');
      throw new FanqieServiceError('fanqie_relogin_unverified', `番茄账号 ${accountId} 登录后校验未通过（${after.status}）`, 401, after.evidence);
    }
    this.log(`${accountId} 登录成功，cookie 已更新`);
  }

  private async check(accountId: string, quick: boolean): Promise<SessionCheckResult> {
    const result = await this.inner.checkSession(accountId, { quick });
    this.record(result);
    return result;
  }

  private record(result: SessionCheckResult) {
    if (result.valid) this.validUntil.set(result.accountId, Date.now() + this.cacheMs);
    else this.validUntil.delete(result.accountId);
    this.setState(result.accountId, result.status, undefined, result.checkedAt);
  }

  private setState(accountId: string, status: AccountSessionStatus, message?: string, checkedAt = new Date().toISOString()) {
    this.states.set(accountId, { accountId, status, checkedAt, message });
  }
}

function isDriverFailure(error: unknown): boolean {
  return error instanceof FanqieServiceError && (error.code === 'fanqie_driver_failed' || error.code === 'invalid_driver_output');
}

function loginFailureMessage(reason?: string): string {
  switch (reason) {
    case 'cancelled': return '登录窗口被关闭，未完成登录';
    case 'timeout': return '等待番茄登录超时';
    case 'identity_mismatch': return '登录的番茄账号与原账号不一致，已拒绝更新 cookie';
    default: return '番茄登录未完成';
  }
}

/** 后台巡检：定期快速检查所有账号，只更新状态，不弹窗。 */
export function startSessionWatch(options: {
  guard: SessionGuardedFanqieDriver;
  listAccountIds: () => Promise<string[]>;
  runExclusive: <T>(accountId: string, task: () => Promise<T>) => Promise<T>;
  intervalMs: number;
  log?: (message: string) => void;
}): () => void {
  const log = options.log ?? ((message) => console.log(`[session-watch] ${message}`));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const accountId of await options.listAccountIds()) {
        const state = await options.runExclusive(accountId, () => options.guard.refreshState(accountId)).catch((error) => {
          log(`${accountId} 检查失败：${error instanceof Error ? error.message : String(error)}`);
          return null;
        });
        if (state?.status === 'expired') log(`${accountId} 登录态已失效，下次需要登录的任务会打开登录窗口`);
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), options.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

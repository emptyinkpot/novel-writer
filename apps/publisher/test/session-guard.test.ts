import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionGuardedFanqieDriver } from '../src/drivers/fanqie/SessionGuardedFanqieDriver.js';
import { NotConfiguredFanqiePlatformDriver, type FanqiePlatformDriver } from '../src/drivers/fanqie/FanqiePlatformDriver.js';
import { FanqieServiceError } from '../src/sdk/errors.js';
import type { LoginResult, PlatformConfirmationEvidence, PublishChapterInput, SessionCheckResult } from '../src/sdk/types.js';

type Status = SessionCheckResult['status'];

/** 可编排的假 driver：按顺序返回检查结果，记录调用。 */
class FakeDriver implements FanqiePlatformDriver {
  readonly configured = true;
  readonly name = "fake";
  private readonly base = new NotConfiguredFanqiePlatformDriver();
  loginDiscovered() { return this.base.loginDiscovered(); }
  scanWorks() { return this.base.scanWorks(); }
  syncRemoteChapters() { return this.base.syncRemoteChapters(); }
  getRemoteChapter() { return this.base.getRemoteChapter(); }
  editRemoteChapter() { return this.base.editRemoteChapter(); }
  checks: Status[] = [];
  loginResult: LoginResult['status'] = 'completed';
  loginReason?: string;
  loginDelayMs = 0;
  publishFailures = 0;
  calls: string[] = [];

  async checkSession(accountId: string): Promise<SessionCheckResult> {
    const status = this.checks.shift() ?? 'valid';
    this.calls.push(`check:${status}`);
    return { accountId, valid: status === 'valid', status, checkedAt: new Date().toISOString() };
  }

  async login(accountId: string): Promise<LoginResult> {
    this.calls.push('login');
    if (this.loginDelayMs) await new Promise((r) => setTimeout(r, this.loginDelayMs));
    return { accountId, status: this.loginResult, reason: this.loginReason, headed: true };
  }

  async publishChapter(input: PublishChapterInput): Promise<PlatformConfirmationEvidence> {
    this.calls.push('publish');
    if (this.publishFailures > 0) {
      this.publishFailures -= 1;
      throw new FanqieServiceError('fanqie_driver_failed', 'page redirected', 502);
    }
    return { platform: 'fanqie', accountId: input.accountId, bookId: input.bookId, chapterNumber: input.chapterNumber, confirmed: true, confirmedAt: '', evidence: {} };
  }
}

const input: PublishChapterInput = { accountId: 'acc', bookId: 'b1', chapterNumber: 1, title: 't', content: 'c' };
const quiet = { log: () => {} };

test('valid session: runs once, no login, result is cached', async () => {
  const fake = new FakeDriver();
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await guard.publishChapter(input);
  await guard.publishChapter(input);
  assert.deepEqual(fake.calls, ['check:valid', 'publish', 'publish']);
  assert.equal(guard.getState('acc').status, 'valid');
});

test('expired before task: opens login, verifies, then runs', async () => {
  const fake = new FakeDriver();
  fake.checks = ['expired', 'valid'];
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await guard.publishChapter(input);
  assert.deepEqual(fake.calls, ['check:expired', 'login', 'check:valid', 'publish']);
});

test('expires mid-task: relogin and retry exactly once', async () => {
  const fake = new FakeDriver();
  fake.checks = ['valid', 'expired', 'valid'];
  fake.publishFailures = 1;
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await guard.publishChapter(input);
  assert.deepEqual(fake.calls, ['check:valid', 'publish', 'check:expired', 'login', 'check:valid', 'publish']);
});

test('failure not caused by session: original error, no login', async () => {
  const fake = new FakeDriver();
  fake.checks = ['valid', 'valid'];
  fake.publishFailures = 1;
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await assert.rejects(() => guard.publishChapter(input), /page redirected/);
  assert.ok(!fake.calls.includes('login'));
});

test('unknown status (e.g. network) never triggers login', async () => {
  const fake = new FakeDriver();
  fake.checks = ['unknown'];
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await guard.publishChapter(input);
  assert.deepEqual(fake.calls, ['check:unknown', 'publish']);
});

test('login cancelled / timeout / identity mismatch: task fails, not executed', async () => {
  for (const reason of ['cancelled', 'timeout', 'identity_mismatch']) {
    const fake = new FakeDriver();
    fake.checks = ['expired'];
    fake.loginResult = 'failed';
    fake.loginReason = reason;
    const guard = new SessionGuardedFanqieDriver(fake, quiet);
    await assert.rejects(() => guard.publishChapter(input), (error: FanqieServiceError) => error.code === `fanqie_login_${reason}`);
    assert.ok(!fake.calls.includes('publish'));
    assert.equal(guard.getState('acc').status, 'login_failed');
  }
});

test('login completes but session still invalid: task fails', async () => {
  const fake = new FakeDriver();
  fake.checks = ['expired', 'expired'];
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await assert.rejects(() => guard.publishChapter(input), (error: FanqieServiceError) => error.code === 'fanqie_relogin_unverified');
  assert.ok(!fake.calls.includes('publish'));
});

test('concurrent tasks on an expired account share one login window', async () => {
  const fake = new FakeDriver();
  fake.checks = ['expired', 'expired', 'valid'];
  fake.loginDelayMs = 30;
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await Promise.all([guard.publishChapter(input), guard.publishChapter(input)]);
  assert.equal(fake.calls.filter((c) => c === 'login').length, 1);
  assert.equal(fake.calls.filter((c) => c === 'publish').length, 2);
});

test('auto relogin disabled: reports login required without opening a window', async () => {
  const fake = new FakeDriver();
  fake.checks = ['expired'];
  const guard = new SessionGuardedFanqieDriver(fake, { ...quiet, autoRelogin: false });
  await assert.rejects(() => guard.publishChapter(input), (error: FanqieServiceError) => error.code === 'fanqie_login_required');
  assert.ok(!fake.calls.includes('login'));
});

test('missing account: clear error, no login', async () => {
  const fake = new FakeDriver();
  fake.checks = ['missing'];
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  await assert.rejects(() => guard.publishChapter(input), (error: FanqieServiceError) => error.code === 'fanqie_account_missing');
  assert.ok(!fake.calls.includes('login'));
});

test('background refresh only records state, never logs in', async () => {
  const fake = new FakeDriver();
  fake.checks = ['expired'];
  const guard = new SessionGuardedFanqieDriver(fake, quiet);
  const state = await guard.refreshState('acc');
  assert.equal(state.status, 'expired');
  assert.deepEqual(fake.calls, ['check:expired']);
});

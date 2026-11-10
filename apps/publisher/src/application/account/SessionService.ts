import type { FanqiePlatformDriver } from '../../drivers/fanqie/FanqiePlatformDriver.js';
import type { ReauthResult } from '../../sdk/types.js';
import { SessionGuardedFanqieDriver, type AccountSessionState } from '../../drivers/fanqie/SessionGuardedFanqieDriver.js';

export class SessionService {
  constructor(private readonly driver: FanqiePlatformDriver) {}

  /** 登录态守卫记录的账号状态（valid / expired / waiting_login / login_failed ...）。 */
  sessionState(accountId?: string): AccountSessionState | AccountSessionState[] {
    if (!(this.driver instanceof SessionGuardedFanqieDriver)) {
      return accountId ? { accountId, status: 'unknown' } : [];
    }
    return accountId ? this.driver.getState(accountId) : this.driver.listStates();
  }

  login(accountId: string) {
    return this.driver.login(accountId);
  }

  loginDiscovered() {
    return this.driver.loginDiscovered();
  }

  checkSession(accountId: string) {
    return this.driver.checkSession(accountId);
  }

  async reauth(accountId: string): Promise<ReauthResult> {
    const before = await this.driver.checkSession(accountId, { quick: true });
    if (before.valid) {
      return {
        accountId,
        status: 'valid',
        checkedAt: before.checkedAt,
        before,
        after: before,
        evidence: {
          skippedLogin: true,
          reason: 'session_already_valid',
        },
      };
    }

    const login = await this.driver.login(accountId, { waitForCompletion: true });
    const after = await this.driver.checkSession(accountId, { quick: true });
    return {
      accountId,
      status: after.valid ? 'valid' : 'failed',
      checkedAt: after.checkedAt,
      before,
      login,
      after,
      evidence: {
        waitForCompletion: true,
        beforeStatus: before.status,
        afterStatus: after.status,
      },
    };
  }
}

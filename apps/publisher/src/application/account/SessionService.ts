import type { FanqiePlatformDriver } from '../../drivers/fanqie/FanqiePlatformDriver.js';
import type { ReauthResult } from '../../sdk/types.js';

export class SessionService {
  constructor(private readonly driver: FanqiePlatformDriver) {}

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
    const before = await this.checkSession(accountId);
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
    const after = await this.checkSession(accountId);
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

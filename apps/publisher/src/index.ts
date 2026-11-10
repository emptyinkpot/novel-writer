import { createContainer } from './container.js';
import { startSessionWatch } from './drivers/fanqie/SessionGuardedFanqieDriver.js';

const container = createContainer();

container.app.listen(container.config.port, container.config.host, () => {
  console.log(`[fanqie-service] listening on http://${container.config.host}:${container.config.port}`);
});

// 后台巡检登录态：只记录状态，不弹窗。FANQIE_SESSION_WATCH_MINUTES=0 关闭。
const watchMinutes = Number(process.env.FANQIE_SESSION_WATCH_MINUTES ?? 180);
if (watchMinutes > 0) {
  startSessionWatch({
    guard: container.sessionGuard,
    listAccountIds: async () => (await container.accounts.listAccounts()).filter((a) => a.status === 'active').map((a) => a.id),
    runExclusive: (accountId, task) => container.accountLock.run(accountId, task),
    intervalMs: watchMinutes * 60 * 1000,
  });
}

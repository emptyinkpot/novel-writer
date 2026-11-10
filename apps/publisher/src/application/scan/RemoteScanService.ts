import type { FanqiePlatformDriver } from '../../drivers/fanqie/FanqiePlatformDriver.js';
import type { LocalPublicationStore } from '../../infrastructure/local/LocalPublicationStore.js';
import type { AccountLock } from '../../runtime/locks/AccountLock.js';
import type { RemoteChapterSnapshot, ScanWorksInput, SyncRemoteChaptersInput } from '../../sdk/types.js';

export class RemoteScanService {
  constructor(
    private readonly driver: FanqiePlatformDriver,
    private readonly database: LocalPublicationStore,
    private readonly accountLock?: AccountLock,
  ) {}

  async scanWorks(input: ScanWorksInput) {
    const works = await this.runWithAccountLock(input.accountId, () => this.driver.scanWorks(input));
    if (works.length > 0) {
      await this.database.syncFanqieWorks(works);
    }
    return works;
  }

  async syncRemoteChapters(input: SyncRemoteChaptersInput) {
    const chapters = await this.runWithAccountLock(input.accountId, () => this.driver.syncRemoteChapters(input));
    if (chapters.length > 0 && input.persist !== false) {
      await this.persistRemoteChapters({
        accountId: input.accountId,
        bookId: input.bookId,
        chapters,
      });
    }
    return chapters;
  }

  private runWithAccountLock<T>(accountId: string | undefined, task: () => Promise<T>) {
    if (!accountId || !this.accountLock) return task();
    return this.accountLock.run(accountId, task);
  }

  private async persistRemoteChapters(input: { accountId: string; bookId: string; chapters: RemoteChapterSnapshot[] }) {
    try {
      await this.database.syncFanqieRemoteChapters(input);
    } catch (error) {
      if (!isPrivilegeDenied(error)) throw error;
      // 远端列表读取是编辑/下一章定位的主路径；快照表权限缺失不能阻断只读定位。
    }
  }
}

function isPrivilegeDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /command denied|permission denied|access denied/i.test(message);
}

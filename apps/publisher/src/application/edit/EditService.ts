import type { FanqiePlatformDriver } from '../../drivers/fanqie/FanqiePlatformDriver.js';
import type { AccountLock } from '../../runtime/locks/AccountLock.js';
import type { EditChapterResult, EditRemoteChapterInput, RemoteChapterDetail } from '../../sdk/types.js';
import { FanqieServiceError } from '../../sdk/errors.js';

export class EditService {
  constructor(
    private readonly driver: FanqiePlatformDriver,
    private readonly accountLock?: AccountLock,
  ) {}

  getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail> {
    validateRemoteChapterIdentity(input);
    return this.runWithAccountLock(input.accountId, () => this.driver.getRemoteChapter(input));
  }

  async editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult> {
    validateRemoteChapterIdentity(input);
    const titleText = typeof input.title === 'string' ? input.title.trim() : '';
    const contentText = typeof input.contentText === 'string' ? input.contentText.trim() : '';
    if (!titleText && !contentText) {
      throw new FanqieServiceError('invalid_edit_input', 'title or contentText is required', 400);
    }
    if (input.dryRun) {
      const before = await this.getRemoteChapter(input);
      return {
        success: true,
        accountId: input.accountId,
        bookId: input.bookId,
        itemId: input.itemId,
        before: { ...before },
        after: {
          ...before,
          title: titleText || before.title,
          contentText: contentText || before.contentText,
        },
        verification: {
          dryRun: true,
          wouldChangeTitle: Boolean(titleText && normalizeChapterTitle(input.title) !== normalizeChapterTitle(before.title)),
          wouldChangeContent: Boolean(contentText && contentText !== before.contentText),
        },
        evidence: { dryRun: true },
      };
    }
    return this.runWithAccountLock(input.accountId, () => this.driver.editRemoteChapter(input));
  }

  private runWithAccountLock<T>(accountId: string, task: () => Promise<T>) {
    if (!this.accountLock) return task();
    return this.accountLock.run(accountId, task);
  }
}

function normalizeChapterTitle(value: unknown): string {
  const text = value == null ? '' : String(value).trim();
  const match = text.match(/^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s+(.+)$/u);
  return match ? match[1].trim() : text;
}

function validateRemoteChapterIdentity(input: { accountId?: string; bookId?: string; itemId?: string }) {
  if (typeof input.accountId !== 'string' || !input.accountId.trim()) throw new FanqieServiceError('invalid_edit_input', 'accountId is required', 400);
  if (typeof input.bookId !== 'string' || !input.bookId.trim()) throw new FanqieServiceError('invalid_edit_input', 'bookId is required', 400);
  if (typeof input.itemId !== 'string' || !input.itemId.trim()) throw new FanqieServiceError('invalid_edit_input', 'itemId is required', 400);
}

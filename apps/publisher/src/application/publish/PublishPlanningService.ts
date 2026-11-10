import type { EditService } from '../edit/EditService.js';
import type { RemoteScanService } from '../scan/RemoteScanService.js';
import type { DataBasePublicationClient } from '../../infrastructure/database/DataBasePublicationClient.js';
import { FanqieServiceError } from '../../sdk/errors.js';
import type {
  CompareDatabaseChapterInput,
  CompareDatabaseChapterResult,
  DatabasePublishResolution,
  RemoteChapterSnapshot,
  ValidateDatabaseChapterInput,
  ValidateDatabaseChapterResult,
} from '../../sdk/types.js';

export class PublishPlanningService {
  constructor(
    private readonly database: DataBasePublicationClient,
    private readonly scan: RemoteScanService,
    private readonly edit: EditService,
  ) {}

  async validateDatabaseChapter(input: ValidateDatabaseChapterInput): Promise<ValidateDatabaseChapterResult> {
    const resolution = await this.database.resolvePublishChapter(input);
    const chapters = await this.scan.syncRemoteChapters({
      accountId: resolution.accountId,
      bookId: resolution.bookId,
      refresh: true,
      persist: false,
    });
    const latestChapterNumber = latestRemoteChapterNumber(chapters);
    const matching = findRemoteChapter(chapters, resolution.chapter.chapterNumber);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!resolution.chapter.title.trim()) errors.push('chapter title is empty');
    if (!resolution.chapter.content.trim()) errors.push('chapter content is empty');
    if (matching) errors.push(`remote chapter already exists: ${resolution.chapter.chapterNumber}`);
    if (resolution.chapter.chapterNumber !== latestChapterNumber + 1) {
      warnings.push(`chapter number is ${resolution.chapter.chapterNumber}, remote next chapter is ${latestChapterNumber + 1}`);
    }
    if (resolution.chapter.publishedAt) warnings.push(`database chapter has publishedAt: ${resolution.chapter.publishedAt}`);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      resolution,
      remote: {
        latestChapterNumber,
        nextChapterNumber: latestChapterNumber + 1,
        chapterExists: Boolean(matching),
        itemId: matching ? matching.itemId : undefined,
      },
    };
  }

  async compareDatabaseChapter(input: CompareDatabaseChapterInput): Promise<CompareDatabaseChapterResult> {
    const resolution = await this.database.resolvePublishChapter(input);
    const itemId = await this.resolveRemoteItemId(input, resolution);
    const remote = await this.edit.getRemoteChapter({
      accountId: resolution.accountId,
      bookId: resolution.bookId,
      itemId,
    });
    const databaseTitle = input.title == null || String(input.title).trim() === ''
      ? resolution.chapter.title
      : String(input.title);
    const databaseContent = input.contentText == null || String(input.contentText).trim() === ''
      ? resolution.chapter.content
      : String(input.contentText);
    const remoteContent = remote.contentText;
    return {
      accountId: resolution.accountId,
      bookId: resolution.bookId,
      localWorkId: resolution.localWorkId,
      chapterNumber: resolution.chapter.chapterNumber,
      itemId,
      titleMatched: normalizeTitle(databaseTitle) === normalizeTitle(remote.title),
      contentMatched: normalizeContent(databaseContent) === normalizeContent(remoteContent),
      database: {
        ...resolution.chapter,
        title: databaseTitle,
        content: databaseContent,
      },
      remote,
      diff: {
        databaseTitle,
        remoteTitle: remote.title,
        databaseContentLength: databaseContent.length,
        remoteContentLength: remoteContent.length,
        databaseWordCount: resolution.chapter.wordCount,
        remoteWordCount: remote.wordCount,
      },
    };
  }

  async resolveRemoteItemId(input: { itemId?: string }, resolution: DatabasePublishResolution): Promise<string> {
    if (typeof input.itemId === 'string' && input.itemId.trim() !== '') return input.itemId.trim();
    const chapters = await this.scan.syncRemoteChapters({
      accountId: resolution.accountId,
      bookId: resolution.bookId,
      refresh: true,
      persist: false,
    });
    const chapter = findRemoteChapter(chapters, resolution.chapter.chapterNumber);
    if (!chapter || !chapter.itemId) {
      throw new FanqieServiceError(
        'remote_chapter_not_found',
        `remote chapter itemId not found for ${resolution.bookId}#${resolution.chapter.chapterNumber}`,
        404,
      );
    }
    return chapter.itemId;
  }
}

function latestRemoteChapterNumber(chapters: RemoteChapterSnapshot[]): number {
  return chapters.reduce((max, chapter) => {
    const chapterNumber = Number(chapter.chapterNumber);
    if (!Number.isFinite(chapterNumber)) return max;
    return Math.max(max, chapterNumber);
  }, 0);
}

function findRemoteChapter(chapters: RemoteChapterSnapshot[], chapterNumber: number): RemoteChapterSnapshot | undefined {
  return chapters.find((item) => Number(item.chapterNumber) === Number(chapterNumber));
}

function normalizeTitle(value: string): string {
  const text = value.trim();
  const match = text.match(/^第\s*[0-9一二三四五六七八九十百千万零两]+\s*章\s+(.+)$/u);
  return match ? match[1].trim() : text;
}

function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

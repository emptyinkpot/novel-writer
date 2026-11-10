import { randomUUID } from 'node:crypto';
import { FanqieServiceError } from '../../sdk/errors.js';
import { listAccounts, openLibraryDb, openPublisherDb, type SqliteDb } from '../../runtime/browser/local-store.mjs';
import type {
  DatabaseChapterForPublish,
  DatabasePublicationTarget,
  DatabasePublishContext,
  DatabasePublishResolution,
  DatabaseRecordPublicationResult,
  DatabaseRecordPublicationResultInput,
  DatabaseRegisterPublicationTargetInput,
  DatabaseSyncFanqieWorksResult,
  FanqieAccount,
  PublishDatabaseChapterInput,
  RemoteChapterSnapshot,
  RemoteWorkSnapshot,
} from '../../sdk/types.js';

export interface PublicationTargetQuery {
  platform?: string;
  accountIdentity?: string;
  localWorkId?: string | number;
  remoteWorkId?: string;
  limit?: number;
}

export interface FanqieWorksQuery {
  search?: string;
  accountId?: string;
  limit?: number;
}

export interface PublishContextQuery {
  targetId?: string;
  accountId?: string;
  bookId?: string;
  localWorkId?: string | number;
  limit?: number;
}

/** 章节来源：novel-writer 自己的作品库。测试时可替换。 */
export interface ChapterSource {
  listChapters(localWorkId: string): DatabaseChapterForPublish[];
}

export class SqliteLibraryChapterSource implements ChapterSource {
  listChapters(localWorkId: string): DatabaseChapterForPublish[] {
    const db = openLibraryDb();
    if (!db) {
      throw new FanqieServiceError('library_not_found', '本地作品库不存在：先启动 apps/api 并创建作品', 404);
    }
    try {
      const rows = db
        .prepare('SELECT id, work_id, title, content FROM nw_chapters WHERE work_id = ? ORDER BY sort_order, id')
        .all(Number(localWorkId)) as Array<{ id: number; work_id: number; title: string; content: string | null }>;
      return rows.map((row, index) => ({
        id: String(row.id),
        workId: String(row.work_id),
        chapterNumber: index + 1,
        title: row.title || '',
        content: row.content || '',
        wordCount: countWords(row.content || ''),
      }));
    } finally {
      db.close();
    }
  }
}

/**
 * publisher 的本地发布存储，替代原来的 DataBase Gateway。
 * publication_targets 把「本地作品 + 番茄账号 + 番茄远端作品」绑定成唯一发布目标。
 */
export class LocalPublicationStore {
  private readonly db: SqliteDb;

  constructor(options: { db?: SqliteDb; chapters?: ChapterSource } = {}) {
    this.db = options.db ?? openPublisherDb();
    this.chapters = options.chapters ?? new SqliteLibraryChapterSource();
  }

  private readonly chapters: ChapterSource;

  async listPublicationTargets(query: PublicationTargetQuery = {}): Promise<DatabasePublicationTarget[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.platform) { where.push('platform = ?'); params.push(query.platform); }
    if (query.accountIdentity) { where.push('account_identity = ?'); params.push(query.accountIdentity); }
    if (query.localWorkId != null && query.localWorkId !== '') { where.push('local_work_id = ?'); params.push(String(query.localWorkId)); }
    if (query.remoteWorkId) { where.push('remote_work_id = ?'); params.push(query.remoteWorkId); }
    const sql = `SELECT * FROM publication_targets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at LIMIT ?`;
    return (this.db.prepare(sql).all(...params, normalizeLimit(query.limit, 100)) as TargetRow[]).map(targetFromRow);
  }

  async listFanqieWorks(query: FanqieWorksQuery = {}): Promise<Record<string, unknown>[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.accountId) { where.push('account_id = ?'); params.push(query.accountId); }
    if (query.search) { where.push('(title LIKE ? OR work_id = ?)'); params.push(`%${query.search}%`, query.search); }
    const sql = `SELECT * FROM fanqie_works ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY scanned_at DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...params, normalizeLimit(query.limit, 100)) as FanqieWorkRow[]).map((row) => ({
      id: row.id,
      account_id: row.account_id,
      work_id: row.work_id,
      book_id: row.work_id,
      title: row.title,
      chapter_count: row.chapter_count,
      latest_chapter_number: row.latest_chapter_number,
      scanned_at: row.scanned_at,
      raw: parseJson(row.raw, null),
    }));
  }

  async syncFanqieWorks(works: RemoteWorkSnapshot[]): Promise<DatabaseSyncFanqieWorksResult> {
    const syncedAt = new Date().toISOString();
    const find = this.db.prepare('SELECT id FROM fanqie_works WHERE account_id = ? AND work_id = ?');
    const upsert = this.db.prepare(`INSERT INTO fanqie_works (account_id, work_id, title, chapter_count, latest_chapter_number, raw, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, work_id) DO UPDATE SET title = excluded.title, chapter_count = excluded.chapter_count,
        latest_chapter_number = excluded.latest_chapter_number, raw = excluded.raw, scanned_at = excluded.scanned_at`);
    const result: DatabaseSyncFanqieWorksResult['works'] = [];
    this.db.transaction(() => {
      for (const work of works) {
        const existing = find.get(work.accountId, work.bookId) as { id: number } | undefined;
        upsert.run(work.accountId, work.bookId, work.title, work.chapterCount ?? null, work.latestChapterNumber ?? null,
          work.raw ? JSON.stringify(work.raw) : null, work.scannedAt || syncedAt);
        const row = find.get(work.accountId, work.bookId) as { id: number };
        result.push({ id: row.id, accountId: work.accountId, bookId: work.bookId, title: work.title, action: existing ? 'updated' : 'inserted' });
      }
    })();
    return { syncedAt, count: result.length, works: result };
  }

  async syncFanqieRemoteChapters(input: { accountId: string; bookId: string; chapters: RemoteChapterSnapshot[] }): Promise<Record<string, unknown>> {
    const syncedAt = new Date().toISOString();
    const upsert = this.db.prepare(`INSERT INTO fanqie_remote_chapters (account_id, book_id, chapter_number, item_id, title, word_count, published_at, raw, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, book_id, chapter_number) DO UPDATE SET item_id = excluded.item_id, title = excluded.title,
        word_count = excluded.word_count, published_at = excluded.published_at, raw = excluded.raw, synced_at = excluded.synced_at`);
    this.db.transaction(() => {
      for (const ch of input.chapters) {
        upsert.run(input.accountId, input.bookId, ch.chapterNumber, ch.itemId ?? null, ch.title ?? null, ch.wordCount ?? null,
          ch.publishedAt ?? null, ch.raw ? JSON.stringify(ch.raw) : null, ch.syncedAt || syncedAt);
      }
    })();
    return { accountId: input.accountId, bookId: input.bookId, chapterCount: input.chapters.length, syncedAt };
  }

  async registerPublicationTarget(input: DatabaseRegisterPublicationTargetInput): Promise<DatabasePublicationTarget> {
    const accountIdentity = required(input.accountIdentity || input.accountId, 'accountId');
    const remoteWorkId = input.remoteWorkId || input.bookId || null;
    const localWorkId = required(input.localWorkId, 'localWorkId');
    const t = new Date().toISOString();
    const existing = (input.targetId
      ? this.db.prepare('SELECT * FROM publication_targets WHERE id = ?').get(input.targetId)
      : this.db.prepare("SELECT * FROM publication_targets WHERE platform = 'fanqie' AND account_identity = ? AND remote_work_id IS ?").get(accountIdentity, remoteWorkId)) as TargetRow | undefined;
    const metadata = JSON.stringify({ ...(existing ? parseJson(existing.metadata, {}) : {}), ...(input.metadata || {}), title: input.title, author: input.author });
    if (existing) {
      this.db.prepare('UPDATE publication_targets SET account_identity = ?, local_work_id = ?, remote_work_id = ?, status = ?, metadata = ?, updated_at = ? WHERE id = ?')
        .run(accountIdentity, localWorkId, remoteWorkId, input.status || existing.status, metadata, t, existing.id);
      return targetFromRow(this.db.prepare('SELECT * FROM publication_targets WHERE id = ?').get(existing.id) as TargetRow);
    }
    const id = input.targetId || `pt_${randomUUID()}`;
    this.db.prepare(`INSERT INTO publication_targets (id, platform, account_identity, local_work_id, remote_work_id, status, metadata, created_at, updated_at)
      VALUES (?, 'fanqie', ?, ?, ?, ?, ?, ?, ?)`).run(id, accountIdentity, localWorkId, remoteWorkId, input.status || 'active', metadata, t, t);
    return targetFromRow(this.db.prepare('SELECT * FROM publication_targets WHERE id = ?').get(id) as TargetRow);
  }

  async recordPublicationResult(input: DatabaseRecordPublicationResultInput): Promise<DatabaseRecordPublicationResult> {
    const target = input.targetId
      ? (await this.listPublicationTargets({ limit: 500 })).find((t) => t.id === input.targetId)
      : (await this.listPublicationTargets({ platform: 'fanqie', accountIdentity: input.accountId, remoteWorkId: input.bookId, limit: 1 }))[0]
        ?? (await this.registerPublicationTarget({ accountId: input.accountId, bookId: input.bookId, localWorkId: input.localWorkId }));
    if (!target) throw new FanqieServiceError('publication_target_not_found', `publication target not found: ${input.targetId}`, 404);
    const recordId = `pr_${randomUUID()}`;
    const chapterId = input.chapterId == null || input.chapterId === '' ? null : Number(input.chapterId);
    this.db.prepare(`INSERT INTO publication_records (id, target_id, local_work_id, chapter_id, chapter_number, action, remote_part_id, observed_status, published_at, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      recordId, target.id, String(input.localWorkId), chapterId, input.chapterNumber, input.action, input.remotePartId ?? null,
      input.observedStatus, input.publishedAt ?? null, input.result ? JSON.stringify(input.result) : null, new Date().toISOString(),
    );
    return {
      recordId,
      targetId: target.id,
      contentPartId: input.contentPartId ?? null,
      chapterId,
      chapterNumber: input.chapterNumber,
      action: input.action,
      remotePartId: input.remotePartId ?? null,
      observedStatus: input.observedStatus,
      chapterStatus: input.observedStatus === 'failed' ? null : input.observedStatus,
      contentPartStatus: null,
    };
  }

  async listFanqieAccounts(): Promise<FanqieAccount[]> {
    return listAccounts(this.db).map((row) => ({
      id: row.accountId,
      name: row.name ?? undefined,
      aliases: row.aliases,
      status: row.status === 'disabled' ? 'disabled' : 'active',
      cookiesStorageType: 'external',
      meta: {
        source: 'local',
        cookieCount: row.session.cookieCount,
        sessionSyncedAt: row.session.syncedAt,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async getPublishContext(query: PublishContextQuery = {}): Promise<DatabasePublishContext> {
    const resolved = await this.resolveTargetQuery(query);
    const publicationTargets = await this.listPublicationTargets({
      platform: 'fanqie',
      accountIdentity: resolved.accountId,
      localWorkId: resolved.localWorkId,
      limit: normalizeLimit(query.limit, 200),
    });
    const matchedTarget = publicationTargets.find((t) => !resolved.bookId || t.remoteWorkId === String(resolved.bookId));
    const fanqieWorks = await this.listFanqieWorks({ accountId: resolved.accountId, limit: normalizeLimit(query.limit, 200) });
    const bookId = resolved.bookId ?? matchedTarget?.remoteWorkId ?? undefined;
    return {
      accountId: resolved.accountId ?? matchedTarget?.accountIdentity,
      bookId: bookId ?? undefined,
      localWorkId: resolved.localWorkId != null ? String(resolved.localWorkId) : matchedTarget?.localWorkId,
      publicationTargets,
      fanqieWorks,
      matchedTarget,
      matchedFanqieWork: fanqieWorks.find((w) => String(w.work_id) === String(bookId)),
    };
  }

  async resolvePublishChapter(input: PublishDatabaseChapterInput): Promise<DatabasePublishResolution> {
    const context = await this.getPublishContext({
      accountId: input.accountId,
      bookId: input.bookId,
      localWorkId: input.localWorkId,
      targetId: input.targetId,
      limit: 200,
    });
    const accountId = required(context.accountId || input.accountId, 'accountId');
    const bookId = required(context.bookId || input.bookId, 'bookId');
    const localWorkId = required(context.localWorkId || input.localWorkId, 'localWorkId');
    const chapters = this.chapters.listChapters(localWorkId);
    const chapter = input.chapterId != null && input.chapterId !== ''
      ? chapters.find((c) => c.id === String(input.chapterId))
      : input.chapterNumber != null
        ? chapters.find((c) => c.chapterNumber === Number(input.chapterNumber))
        : chapters.find((c) => !this.publishedAt(localWorkId, c.chapterNumber));
    if (!chapter) {
      throw new FanqieServiceError('chapter_not_found', `作品 ${localWorkId} 中找不到要发布的章节`, 404, {
        chapterId: input.chapterId, chapterNumber: input.chapterNumber, chapterCount: chapters.length,
      });
    }
    const resolvedChapter = { ...chapter, publishedAt: this.publishedAt(localWorkId, chapter.chapterNumber) };
    return {
      accountId,
      bookId,
      localWorkId,
      chapter: resolvedChapter,
      context,
      publishInput: {
        accountId,
        bookId,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        content: chapter.content,
        idempotencyKey: input.idempotencyKey,
        headless: input.headless,
        dryRun: input.dryRun,
        waitForCompletion: input.waitForCompletion,
        source: { workId: localWorkId, chapterId: chapter.id, requestId: input.requestId },
      },
    };
  }

  private publishedAt(localWorkId: string, chapterNumber: number): string | null {
    const row = this.db.prepare(`SELECT COALESCE(published_at, created_at) AS at FROM publication_records
      WHERE local_work_id = ? AND chapter_number = ? AND action = 'publish_chapter' AND observed_status IN ('submitted', 'published')
      ORDER BY created_at DESC LIMIT 1`).get(localWorkId, chapterNumber) as { at: string } | undefined;
    return row?.at ?? null;
  }

  private async resolveTargetQuery(query: PublishContextQuery): Promise<PublishContextQuery> {
    if (!query.targetId) return query;
    const target = (await this.listPublicationTargets({ limit: 500 })).find((item) => item.id === query.targetId);
    if (!target) throw new FanqieServiceError('publication_target_not_found', `publication target not found: ${query.targetId}`, 404);
    if (target.status !== 'active') throw new FanqieServiceError('publication_target_inactive', `publication target is not active: ${query.targetId}`, 422, target);
    return {
      ...query,
      accountId: blank(query.accountId) ? target.accountIdentity : query.accountId,
      bookId: blank(query.bookId) ? required(target.remoteWorkId, 'bookId') : query.bookId,
      localWorkId: blank(query.localWorkId) ? target.localWorkId : query.localWorkId,
    };
  }
}

interface TargetRow {
  id: string;
  platform: string;
  account_identity: string;
  local_work_id: string;
  remote_work_id: string | null;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

interface FanqieWorkRow {
  id: number;
  account_id: string;
  work_id: string;
  title: string | null;
  chapter_count: number | null;
  latest_chapter_number: number | null;
  raw: string | null;
  scanned_at: string;
}

function targetFromRow(row: TargetRow): DatabasePublicationTarget {
  return {
    id: row.id,
    platform: row.platform,
    accountIdentity: row.account_identity,
    localWorkId: row.local_work_id,
    remoteWorkId: row.remote_work_id,
    status: row.status,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function countWords(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function blank(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

function normalizeLimit(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(Math.trunc(parsed), 500);
}

function required(value: unknown, field: string): string {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new FanqieServiceError('publish_resolution_failed', `${field} is required`, 422);
  return text;
}

export function databaseDependencyUnavailable(error: unknown): FanqieServiceError {
  if (error instanceof FanqieServiceError) return error;
  return new FanqieServiceError('local_store_error', error instanceof Error ? error.message : String(error), 500);
}

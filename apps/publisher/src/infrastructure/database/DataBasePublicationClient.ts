import type { FanqieServiceConfig } from '../../config.js';
import { FanqieServiceError } from '../../sdk/errors.js';
import type {
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

// DataBase 绑定规则：
// publication_targets 是持久执行映射。对番茄来说，它把一个本地作品、
// 一个番茄账号、一个番茄远端作品绑定成唯一发布目标。
//   accountIdentity -> fanqie_accounts.account_id
//   remoteWorkId    -> fanqie_works.work_id / 番茄 bookId
//   localWorkId     -> content_works.id；旧章节表由 DataBase Gateway 解析。
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

interface GatewayMutationResponse<T = Record<string, unknown>> {
  ok?: boolean;
  item?: T;
  result?: Record<string, unknown>;
  requestId?: string;
}

export class DataBasePublicationClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: Pick<FanqieServiceConfig, 'databaseGatewayUrl' | 'databaseGatewayApiKey'>) {
    if (!config.databaseGatewayUrl) {
      throw new FanqieServiceError('database_gateway_url_missing', 'DATABASE_GATEWAY_URL is required', 500);
    }
    this.baseUrl = config.databaseGatewayUrl.replace(/\/+$/, '');
    this.apiKey = config.databaseGatewayApiKey;
  }

  async listPublicationTargets(query: PublicationTargetQuery = {}): Promise<DatabasePublicationTarget[]> {
    const response = await this.get<{ publicationTargets: DatabasePublicationTarget[] }>('/content/publication/targets', {
      platform: query.platform,
      accountIdentity: query.accountIdentity,
      localWorkId: query.localWorkId == null ? undefined : String(query.localWorkId),
      limit: normalizeLimit(query.limit, 100),
    });
    const targets = Array.isArray(response.publicationTargets) ? response.publicationTargets : [];
    return query.remoteWorkId
      ? targets.filter((target) => target.remoteWorkId != null && String(target.remoteWorkId) === String(query.remoteWorkId))
      : targets;
  }

  async listFanqieWorks(query: FanqieWorksQuery = {}): Promise<Record<string, unknown>[]> {
    const response = await this.get<{ fanqieWorks: Record<string, unknown>[] }>('/content/fanqie/works', {
      search: query.search,
      accountId: query.accountId,
      limit: normalizeLimit(query.limit, 100),
    });
    const works = Array.isArray(response.fanqieWorks) ? response.fanqieWorks : [];
    if (!query.search || works.length || !/^\d+$/.test(query.search)) return works;

    const unfilteredResponse = await this.get<{ fanqieWorks: Record<string, unknown>[] }>('/content/fanqie/works', {
      accountId: query.accountId,
      limit: normalizeLimit(query.limit, 100),
    });
    const all = Array.isArray(unfilteredResponse.fanqieWorks) ? unfilteredResponse.fanqieWorks : [];
    return all.filter((work) => ['work_id', 'book_id', 'id'].some((key) => stringField(work, key) === query.search));
  }

  async syncFanqieWorks(works: RemoteWorkSnapshot[]): Promise<DatabaseSyncFanqieWorksResult> {
    const response = await this.post<GatewayMutationResponse<DatabaseSyncFanqieWorksResult>>(
      '/writes/publication/sync-fanqie-works',
      { works: works as unknown as Array<Record<string, unknown>> },
      `fanqie-service:sync-fanqie-works:${stableHash(works)}`,
    );
    const item = response.item;
    if (!item) throw new FanqieServiceError('database_sync_fanqie_works_failed', 'DataBase Gateway did not return sync result', 502, response);
    return item;
  }

  async syncFanqieRemoteChapters(input: {
    accountId: string;
    bookId: string;
    chapters: RemoteChapterSnapshot[];
  }): Promise<Record<string, unknown>> {
    const response = await this.post<GatewayMutationResponse<Record<string, unknown>>>(
      '/writes/publication/sync-fanqie-remote-chapters',
      {
        accountId: input.accountId,
        bookId: input.bookId,
        chapterCount: input.chapters.length,
        chapters: input.chapters as unknown as Array<Record<string, unknown>>,
      },
      `fanqie-service:sync-fanqie-remote-chapters:${stableHash(input)}`,
    );
    const item = response.item;
    if (!item) {
      throw new FanqieServiceError(
        'database_sync_fanqie_remote_chapters_failed',
        'DataBase Gateway did not return remote chapter sync result',
        502,
        response,
      );
    }
    return item;
  }

  async registerPublicationTarget(input: DatabaseRegisterPublicationTargetInput): Promise<DatabasePublicationTarget> {
    const response = await this.post<GatewayMutationResponse<DatabasePublicationTarget>>(
      '/writes/publication/register-target',
      { ...input },
      `fanqie-service:register-target:${stableHash(input)}`,
    );
    const item = response.item;
    if (!item) throw new FanqieServiceError('publication_target_register_failed', 'DataBase Gateway did not return publication target', 502, response);
    return item;
  }

  async recordPublicationResult(input: DatabaseRecordPublicationResultInput): Promise<DatabaseRecordPublicationResult> {
    const response = await this.post<GatewayMutationResponse<DatabaseRecordPublicationResult>>(
      '/writes/publication/record-result',
      { ...input },
      `fanqie-service:publication-record-result:${stableHash(input)}`,
    );
    const item = response.item;
    if (!item) throw new FanqieServiceError('publication_result_record_failed', 'DataBase Gateway did not return publication result', 502, response);
    return item;
  }

  async listFanqieAccounts(): Promise<FanqieAccount[]> {
    const response = await this.get<{ accounts: Array<Record<string, unknown>> }>('/content/publication/accounts', { limit: 500 });
    const accounts = Array.isArray(response.accounts) ? response.accounts : [];
    return accounts.map((row) => ({
      id: required(row.accountId || row.id, 'accountId'),
      name: stringField(row, 'name'),
      aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
      status: stringField(row, 'status') === 'disabled' ? 'disabled' : 'active',
      cookiesStorageType: 'external',
      meta: {
        source: 'database-gateway',
        cookiesStorageType: stringField(row, 'cookiesStorageType') || 'database',
        cookieCount: sessionField(row, 'cookieCount') || null,
        sessionSyncedAt: sessionField(row, 'syncedAt') || null,
      },
      createdAt: stringField(row, 'createdAt') || new Date(0).toISOString(),
      updatedAt: stringField(row, 'updatedAt') || new Date(0).toISOString(),
    }));
  }

  async getPublishContext(query: PublishContextQuery = {}): Promise<DatabasePublishContext> {
    const resolved = await this.resolveTargetQuery(query);
    return this.get<DatabasePublishContext>('/content/publication/publish-context', {
      accountId: resolved.accountId,
      bookId: resolved.bookId,
      localWorkId: resolved.localWorkId,
      limit: normalizeLimit(query.limit, 200),
    });
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
    const response = await this.get<DatabasePublishResolution>('/content/publication/publish-chapter', {
      accountId,
      bookId,
      localWorkId,
      chapterId: input.chapterId,
      chapterNumber: input.chapterNumber,
      requestId: input.requestId,
    });
    return {
      ...response,
      accountId,
      bookId,
      localWorkId,
      context,
      publishInput: {
        ...response.publishInput,
        accountId,
        bookId,
        idempotencyKey: input.idempotencyKey,
        headless: input.headless,
        dryRun: input.dryRun,
        waitForCompletion: input.waitForCompletion,
      },
    };
  }

  private async get<T>(path: string, query: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', `${path}${toQuery(query)}`);
  }

  private async post<T>(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<T> {
    return this.request<T>('POST', path, body, idempotencyKey);
  }

  private async resolveTargetQuery(query: PublishContextQuery): Promise<PublishContextQuery> {
    if (!query.targetId) return query;
    const targets = await this.listPublicationTargets({ platform: 'fanqie', limit: 500 });
    const target = targets.find((item) => item.id === query.targetId);
    if (!target) {
      throw new FanqieServiceError('publication_target_not_found', `publication target not found: ${query.targetId}`, 404);
    }
    if (target.status !== 'active') {
      throw new FanqieServiceError('publication_target_inactive', `publication target is not active: ${query.targetId}`, 422, target);
    }
    const accountId = query.accountId == null || String(query.accountId).trim() === ''
      ? target.accountIdentity
      : query.accountId;
    const bookId = query.bookId == null || String(query.bookId).trim() === ''
      ? target.remoteWorkId
      : query.bookId;
    const localWorkId = query.localWorkId == null || String(query.localWorkId).trim() === ''
      ? target.localWorkId
      : query.localWorkId;
    return {
      ...query,
      accountId: required(accountId, 'accountId'),
      bookId: required(bookId, 'bookId'),
      localWorkId: required(localWorkId, 'localWorkId'),
    };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Actor': 'fanqie-service',
      };
      if (this.apiKey) headers['X-DataBase-Api-Key'] = this.apiKey;
      if (idempotencyKey) {
        headers['X-DataBase-Idempotency-Key'] = idempotencyKey;
        headers['Idempotency-Key'] = idempotencyKey;
      }
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new FanqieServiceError('database_gateway_http_error', `DataBase Gateway returned ${response.status}`, response.status, payload);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof FanqieServiceError) throw error;
      throw new FanqieServiceError(
        'database_gateway_unreachable',
        `DataBase Gateway request failed: ${error instanceof Error ? error.message : String(error)}`,
        502,
        {
          hint: 'Start DataBase Gateway or set DATABASE_GATEWAY_URL/FANQIE_DATABASE_GATEWAY_URL to a Gateway that includes publication routes.',
        },
      );
    }
  }
}

function toQuery(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function normalizeLimit(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(Math.trunc(parsed), 500);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  return value == null ? undefined : String(value);
}

function sessionField(record: Record<string, unknown>, key: string): string | number | null {
  const session = record.session;
  if (!session || typeof session !== 'object') return null;
  const value = (session as Record<string, unknown>)[key];
  if (value == null) return null;
  return typeof value === 'number' ? value : String(value);
}

function required(value: unknown, field: string): string {
  const text = value == null ? '' : String(value).trim();
  if (!text) {
    throw new FanqieServiceError('database_publish_resolution_failed', `${field} is required`, 422);
  }
  return text;
}

function stableHash(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function databaseDependencyUnavailable(error: unknown): FanqieServiceError {
  if (error instanceof FanqieServiceError) return error;
  return new FanqieServiceError(
    'database_gateway_unavailable',
    error instanceof Error ? error.message : String(error),
    502,
  );
}

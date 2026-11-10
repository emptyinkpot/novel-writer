import type {
  DatabasePublicationTarget,
  DatabasePublishContext,
  DatabasePublishResolution,
  DatabaseRegisterPublicationTargetInput,
  DatabaseSyncFanqieWorksResult,
  CompareDatabaseChapterInput,
  CompareDatabaseChapterResult,
  EditChapterResult,
  EditDatabaseChapterInput,
  EditRemoteChapterInput,
  FanqieAccount,
  FanqieClient,
  HealthResult,
  LoginResult,
  ReauthResult,
  PublishChapterInput,
  PublishDatabaseChapterInput,
  PublishNextDatabaseChapterInput,
  PublishJobStatus,
  PublishResult,
  ValidateDatabaseChapterInput,
  ValidateDatabaseChapterResult,
  ReaderBookDetail,
  ReaderBookSummary,
  ReaderBookTextExport,
  ReaderBookTextExportInput,
  ReaderChapterDetail,
  ReaderChapterTextExport,
  ReaderChapterTextExportInput,
  ReaderSearchBooksInput,
  RemoteChapterSnapshot,
  RemoteChapterDetail,
  RemoteWorkSnapshot,
  ScanWorksInput,
  SessionCheckResult,
  SyncRemoteChaptersInput,
} from './types.js';
import { FanqieClientError } from './errors.js';

export interface HttpFanqieClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class HttpFanqieClient implements FanqieClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpFanqieClientOptions) {
    if (!options.baseUrl?.trim()) {
      throw new Error('FanqieClient requires baseUrl');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl || fetch;
    this.accounts = {
      list: () => this.listAccounts(),
      login: (accountId) => this.login(accountId),
      loginDiscovered: () => this.loginDiscovered(),
      checkSession: (accountId) => this.checkSession(accountId),
      reauth: (accountId) => this.reauth(accountId),
    };
    this.library = {
      scanWorks: (input) => this.scanWorks(input),
      syncRemoteChapters: (input) => this.syncRemoteChapters(input),
      getRemoteChapter: (input) => this.getRemoteChapter(input),
    };
    this.database = {
      listPublicationTargets: (input) => this.listDatabasePublicationTargets(input),
      listFanqieWorks: (input) => this.listDatabaseFanqieWorks(input),
      syncFanqieWorks: (input) => this.syncDatabaseFanqieWorks(input),
      registerPublicationTarget: (input) => this.registerDatabasePublicationTarget(input),
      getPublishContext: (input) => this.getDatabasePublishContext(input),
      resolvePublishChapter: (input) => this.resolveDatabasePublishChapter(input),
      validatePublishChapter: (input) => this.validateDatabasePublishChapter(input),
    };
    this.publish = {
      chapter: (input) => this.publishChapter(input),
      tomato: (input) => this.publishTomato(input),
      databaseChapter: (input) => this.publishDatabaseChapter(input),
      nextDatabaseChapter: (input) => this.publishNextDatabaseChapter(input),
      getJob: (jobId) => this.getPublishJob(jobId),
    };
    this.edit = {
      remoteChapter: (input) => this.editRemoteChapter(input),
      databaseChapter: (input) => this.editDatabaseChapter(input),
      compareDatabaseChapter: (input) => this.compareDatabaseChapter(input),
    };
    this.reader = {
      searchBooks: (input) => this.searchReaderBooks(input),
      getBookDetail: (bookIdOrUrl) => this.getReaderBookDetail(bookIdOrUrl),
      getChapterDetail: (itemIdOrUrl) => this.getReaderChapterDetail(itemIdOrUrl),
      exportChapterText: (input) => this.exportReaderChapterText(input),
      exportBookText: (input) => this.exportReaderBookText(input),
    };
  }

  readonly accounts: {
    list: () => Promise<FanqieAccount[]>;
    login: (accountId: string) => Promise<LoginResult>;
    loginDiscovered: () => Promise<LoginResult>;
    checkSession: (accountId: string) => Promise<SessionCheckResult>;
    reauth: (accountId: string) => Promise<ReauthResult>;
  };

  readonly library: {
    scanWorks: (input: ScanWorksInput) => Promise<RemoteWorkSnapshot[]>;
    syncRemoteChapters: (input: SyncRemoteChaptersInput) => Promise<RemoteChapterSnapshot[]>;
    getRemoteChapter: (input: { accountId: string; bookId: string; itemId: string }) => Promise<RemoteChapterDetail>;
  };

  readonly database: {
    listPublicationTargets: (input?: {
      platform?: string;
      accountIdentity?: string;
      localWorkId?: string | number;
      remoteWorkId?: string;
      limit?: number;
    }) => Promise<DatabasePublicationTarget[]>;
    listFanqieWorks: (input?: {
      search?: string;
      accountId?: string;
      limit?: number;
    }) => Promise<Record<string, unknown>[]>;
    syncFanqieWorks: (input: ScanWorksInput) => Promise<DatabaseSyncFanqieWorksResult>;
    registerPublicationTarget: (input: DatabaseRegisterPublicationTargetInput) => Promise<DatabasePublicationTarget>;
    getPublishContext: (input?: {
      accountId?: string;
      bookId?: string;
      localWorkId?: string | number;
      targetId?: string;
      limit?: number;
    }) => Promise<DatabasePublishContext>;
    resolvePublishChapter: (input: PublishDatabaseChapterInput) => Promise<DatabasePublishResolution>;
    validatePublishChapter: (input: ValidateDatabaseChapterInput) => Promise<ValidateDatabaseChapterResult>;
  };

  readonly publish: {
    chapter: (input: PublishChapterInput) => Promise<PublishResult>;
    tomato: (input: PublishChapterInput) => Promise<PublishResult>;
    databaseChapter: (input: PublishDatabaseChapterInput) => Promise<PublishResult>;
    nextDatabaseChapter: (input: PublishNextDatabaseChapterInput) => Promise<PublishResult>;
    getJob: (jobId: string) => Promise<PublishJobStatus>;
  };

  readonly edit: {
    remoteChapter: (input: EditRemoteChapterInput) => Promise<EditChapterResult>;
    databaseChapter: (input: EditDatabaseChapterInput) => Promise<EditChapterResult>;
    compareDatabaseChapter: (input: CompareDatabaseChapterInput) => Promise<CompareDatabaseChapterResult>;
  };

  readonly reader: {
    searchBooks: (input: ReaderSearchBooksInput) => Promise<ReaderBookSummary[]>;
    getBookDetail: (bookIdOrUrl: string) => Promise<ReaderBookDetail>;
    getChapterDetail: (itemIdOrUrl: string) => Promise<ReaderChapterDetail>;
    exportChapterText: (input: ReaderChapterTextExportInput) => Promise<ReaderChapterTextExport>;
    exportBookText: (input: ReaderBookTextExportInput) => Promise<ReaderBookTextExport>;
  };

  health(): Promise<HealthResult> {
    return this.request('GET', '/health');
  }

  listAccounts(): Promise<FanqieAccount[]> {
    return this.request('GET', '/accounts');
  }

  login(accountId: string): Promise<LoginResult> {
    return this.request('POST', `/accounts/${encodeURIComponent(accountId)}/login`, {});
  }

  loginDiscovered(): Promise<LoginResult> {
    return this.request('POST', '/accounts/login/discover', {});
  }

  checkSession(accountId: string): Promise<SessionCheckResult> {
    return this.request('POST', `/accounts/${encodeURIComponent(accountId)}/session/check`, {});
  }

  reauth(accountId: string): Promise<ReauthResult> {
    return this.request('POST', `/accounts/${encodeURIComponent(accountId)}/reauth`, {});
  }

  scanWorks(input: ScanWorksInput): Promise<RemoteWorkSnapshot[]> {
    return this.request('POST', '/works/scan', input);
  }

  syncRemoteChapters(input: SyncRemoteChaptersInput): Promise<RemoteChapterSnapshot[]> {
    return this.request('POST', '/chapters/remote/sync', input);
  }

  getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail> {
    return this.request('GET', `/remote/chapters/${encodeURIComponent(input.bookId)}/${encodeURIComponent(input.itemId)}${toQuery({ accountId: input.accountId })}`);
  }

  searchReaderBooks(input: ReaderSearchBooksInput): Promise<ReaderBookSummary[]> {
    return this.request('GET', `/reader/search${toQuery({ q: input.query, limit: input.limit })}`);
  }

  getReaderBookDetail(bookIdOrUrl: string): Promise<ReaderBookDetail> {
    return this.request('GET', `/reader/books/${encodeURIComponent(bookIdOrUrl)}`);
  }

  getReaderChapterDetail(itemIdOrUrl: string): Promise<ReaderChapterDetail> {
    return this.request('GET', `/reader/chapters/${encodeURIComponent(itemIdOrUrl)}`);
  }

  exportReaderChapterText(input: ReaderChapterTextExportInput): Promise<ReaderChapterTextExport> {
    return this.request('POST', '/reader/export/chapter-text', input);
  }

  exportReaderBookText(input: ReaderBookTextExportInput): Promise<ReaderBookTextExport> {
    return this.request('POST', '/reader/export/book-text', input);
  }

  listDatabasePublicationTargets(input: {
    platform?: string;
    accountIdentity?: string;
    localWorkId?: string | number;
    remoteWorkId?: string;
    limit?: number;
  } = {}): Promise<DatabasePublicationTarget[]> {
    return this.request('GET', `/database/publication-targets${toQuery(input)}`);
  }

  listDatabaseFanqieWorks(input: {
    search?: string;
    accountId?: string;
    limit?: number;
  } = {}): Promise<Record<string, unknown>[]> {
    return this.request('GET', `/database/fanqie-works${toQuery(input)}`);
  }

  syncDatabaseFanqieWorks(input: ScanWorksInput): Promise<DatabaseSyncFanqieWorksResult> {
    return this.request('POST', '/database/sync-fanqie-works', input);
  }

  registerDatabasePublicationTarget(input: DatabaseRegisterPublicationTargetInput): Promise<DatabasePublicationTarget> {
    return this.request('POST', '/database/register-publication-target', input);
  }

  getDatabasePublishContext(input: {
    targetId?: string;
    accountId?: string;
    bookId?: string;
    localWorkId?: string | number;
    limit?: number;
  } = {}): Promise<DatabasePublishContext> {
    return this.request('GET', `/database/publish-context${toQuery(input)}`);
  }

  resolveDatabasePublishChapter(input: PublishDatabaseChapterInput): Promise<DatabasePublishResolution> {
    return this.request('GET', `/database/publish-chapter${toQuery(input as Record<string, unknown>)}`);
  }

  validateDatabasePublishChapter(input: ValidateDatabaseChapterInput): Promise<ValidateDatabaseChapterResult> {
    return this.request('POST', '/publish/database-chapter/validate', input);
  }

  publishChapter(input: PublishChapterInput): Promise<PublishResult> {
    return this.request('POST', '/publish/chapter', input);
  }

  publishTomato(input: PublishChapterInput): Promise<PublishResult> {
    return this.request('POST', '/publish/tomato', input);
  }

  publishDatabaseChapter(input: PublishDatabaseChapterInput): Promise<PublishResult> {
    return this.request('POST', '/publish/database-chapter', input);
  }

  async publishNextDatabaseChapter(input: PublishNextDatabaseChapterInput): Promise<PublishResult> {
    return this.request('POST', '/publish/next-database-chapter', input);
  }

  editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult> {
    return this.request('POST', '/edit/chapter', input);
  }

  editDatabaseChapter(input: EditDatabaseChapterInput): Promise<EditChapterResult> {
    return this.request('POST', '/edit/database-chapter', input);
  }

  compareDatabaseChapter(input: CompareDatabaseChapterInput): Promise<CompareDatabaseChapterResult> {
    return this.request('POST', '/edit/database-chapter/compare', input);
  }

  getPublishJob(jobId: string): Promise<PublishJobStatus> {
    return this.request('GET', `/publish/jobs/${encodeURIComponent(jobId)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok || payload?.success === false) {
      throw new FanqieClientError(payload?.error || response.statusText, {
        status: response.status,
        code: payload?.code || 'fanqie_request_failed',
        details: payload?.details,
      });
    }
    return payload?.data as T;
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

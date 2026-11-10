export interface HealthResult {
  ok: boolean;
  service: 'fanqie-service';
  version: string;
  time: string;
  driver: {
    configured: boolean;
    name: string;
  };
}

export interface FanqieAccount {
  id: string;
  name?: string;
  aliases: string[];
  status: 'active' | 'disabled';
  cookiesStorageType: 'file' | 'profile' | 'external';
  browserProfileKey?: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  accountId: string;
  status: 'started' | 'completed' | 'failed';
  headed: boolean;
  evidence?: Record<string, unknown>;
}

export interface LoginOptions {
  waitForCompletion?: boolean;
}

export interface SessionCheckResult {
  accountId: string;
  valid: boolean;
  status: 'valid' | 'expired' | 'missing' | 'unknown';
  checkedAt: string;
  evidence?: Record<string, unknown>;
}

export interface ReauthResult {
  accountId: string;
  status: 'valid' | 'failed';
  checkedAt: string;
  before: SessionCheckResult;
  login?: LoginResult;
  after: SessionCheckResult;
  evidence?: Record<string, unknown>;
}

export interface ScanWorksInput {
  accountId?: string;
  headed?: boolean;
}

export interface RemoteWorkSnapshot {
  accountId: string;
  platform: 'fanqie';
  bookId: string;
  title: string;
  chapterCount?: number;
  latestChapterNumber?: number;
  scannedAt: string;
  raw?: Record<string, unknown>;
}

export interface SyncRemoteChaptersInput {
  accountId: string;
  bookId: string;
  refresh?: boolean;
  persist?: boolean;
}

export interface RemoteChapterSnapshot {
  accountId: string;
  platform: 'fanqie';
  bookId: string;
  itemId?: string;
  chapterNumber: number;
  title?: string;
  wordCount?: number;
  publishedAt?: string | null;
  syncedAt: string;
  raw?: Record<string, unknown>;
}

export interface RemoteChapterDetail {
  accountId?: string;
  bookId: string;
  itemId: string;
  editUrl?: string;
  chapterNumber?: number;
  title: string;
  contentHtml?: string;
  contentText: string;
  wordCount?: number;
  responseCode?: number | null;
  responseMessage?: string;
  evidence?: Record<string, unknown>;
}

export interface ReaderSearchBooksInput {
  query: string;
  limit?: number;
}

export interface ReaderBookSummary {
  bookId: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  pageUrl: string;
}

export interface ReaderChapterOutline {
  itemId: string;
  title: string;
  chapterNumber?: number;
  volumeName?: string;
  isLocked?: boolean;
}

export interface ReaderBookDetail extends ReaderBookSummary {
  category?: string;
  status?: string;
  wordCount?: number;
  chapterTotal?: number;
  lastChapterItemId?: string;
  lastChapterTitle?: string;
  abstract?: string;
  chapters: ReaderChapterOutline[];
}

export interface ReaderChapterDetail {
  itemId: string;
  bookId: string;
  title: string;
  bookTitle?: string;
  author?: string;
  contentHtml: string;
  contentText: string;
  wordCount?: number;
  prevItemId?: string;
  nextItemId?: string;
  updatedAtText?: string;
  isLocked?: boolean;
}

export interface ReaderChapterTextExportInput {
  itemId: string;
  includeMeta?: boolean;
}

export interface ReaderBookTextExportInput {
  bookId: string;
  itemIds?: string[];
  includeMeta?: boolean;
}

export interface ReaderChapterTextExport {
  format: 'txt';
  filename: string;
  itemId: string;
  bookId: string;
  title: string;
  bookTitle?: string;
  author?: string;
  wordCount?: number;
  content: string;
}

export interface ReaderBookTextExportChapter {
  itemId: string;
  title: string;
  chapterNumber?: number;
  wordCount?: number;
}

export interface ReaderBookTextExportSkippedChapter {
  itemId: string;
  title?: string;
  error: string;
}

export interface ReaderBookTextExport {
  format: 'txt';
  filename: string;
  bookId: string;
  title: string;
  author?: string;
  chapterCount: number;
  exportedChapterCount: number;
  skippedChapters: ReaderBookTextExportSkippedChapter[];
  chapters: ReaderBookTextExportChapter[];
  content: string;
}

export interface ReaderComment {
  id?: string;
  username: string;
  content: string;
  likes?: number;
  timestamp?: string;
  chapterTitle?: string;
}

export interface ReaderBookComments {
  bookId: string;
  comments: ReaderComment[];
  total?: number;
}

export interface PublishChapterInput {
  accountId: string;
  bookId: string;
  chapterNumber: number;
  title: string;
  content: string;
  idempotencyKey?: string;
  headless?: boolean;
  dryRun?: boolean;
  waitForCompletion?: boolean;
  source?: {
    workId?: string | number;
    chapterId?: string | number;
    requestId?: string;
  };
}

export interface PublishDatabaseChapterInput {
  targetId?: string;
  accountId?: string;
  bookId?: string;
  localWorkId?: string | number;
  chapterId?: string | number;
  chapterNumber?: number;
  idempotencyKey?: string;
  headless?: boolean;
  dryRun?: boolean;
  waitForCompletion?: boolean;
  requestId?: string;
}

export interface PublishResult {
  jobId: string;
  accepted: boolean;
  completed: boolean;
  status: PublishJobStatus['status'];
  confirmation?: PlatformConfirmationEvidence;
  error?: string;
}

export interface PublishJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  accountId: string;
  bookId: string;
  chapterNumber: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  dryRun: boolean;
  result?: PlatformConfirmationEvidence;
  error?: string;
}

export interface PlatformConfirmationEvidence {
  platform: 'fanqie';
  accountId: string;
  bookId: string;
  chapterNumber: number;
  confirmed: boolean;
  confirmedAt: string;
  evidence: Record<string, unknown>;
}

export interface DatabasePublicationTarget {
  id: string;
  platform: string;
  accountIdentity: string;
  localWorkId: string;
  remoteWorkId?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatabasePublishContext {
  accountId?: string;
  bookId?: string;
  localWorkId?: string;
  publicationTargets: DatabasePublicationTarget[];
  fanqieWorks: Record<string, unknown>[];
  matchedTarget?: DatabasePublicationTarget;
  matchedFanqieWork?: Record<string, unknown>;
}

export interface DatabaseChapterForPublish {
  id: string;
  workId: string;
  volumeNumber?: number | null;
  chapterNumber: number;
  title: string;
  content: string;
  wordCount?: number | null;
  status?: string | null;
  auditStatus?: string | null;
  publishedAt?: string | null;
}

export interface DatabasePublishResolution {
  accountId: string;
  bookId: string;
  localWorkId: string;
  chapter: DatabaseChapterForPublish;
  context: DatabasePublishContext;
  publishInput: PublishChapterInput;
}

export interface DatabaseSyncFanqieWorksResult {
  syncedAt: string;
  count: number;
  works: Array<{
    id: number;
    accountId: string;
    bookId: string;
    title: string;
    action: 'inserted' | 'updated';
  }>;
}

export interface DatabaseRecordPublicationResultInput {
  targetId?: string;
  accountId: string;
  bookId: string;
  localWorkId: string | number;
  chapterId?: string | number;
  chapterNumber: number;
  contentPartId?: string;
  action: 'publish_chapter' | 'edit_chapter';
  remotePartId?: string;
  observedStatus: 'submitted' | 'published' | 'edited' | 'failed';
  publishedAt?: string;
  result?: Record<string, unknown>;
}

export interface DatabaseRecordPublicationResult {
  recordId: string;
  targetId: string;
  contentPartId: string | null;
  chapterId: number | null;
  chapterNumber: number;
  action: 'publish_chapter' | 'edit_chapter';
  remotePartId: string | null;
  observedStatus: 'submitted' | 'published' | 'edited' | 'failed';
  chapterStatus: string | null;
  contentPartStatus: string | null;
}

export interface DatabaseRegisterPublicationTargetInput {
  targetId?: string;
  accountId?: string;
  accountIdentity?: string;
  bookId?: string;
  remoteWorkId?: string;
  localWorkId: string | number;
  title?: string;
  author?: string | null;
  status?: 'active' | 'paused' | 'retired';
  metadata?: Record<string, unknown>;
}

export interface PublishNextDatabaseChapterInput {
  targetId?: string;
  accountId?: string;
  bookId?: string;
  localWorkId?: string | number;
  dryRun?: boolean;
  headless?: boolean;
  waitForCompletion?: boolean;
  requestId?: string;
}

export interface EditRemoteChapterInput {
  accountId: string;
  bookId: string;
  itemId: string;
  title?: string;
  contentText?: string;
  headless?: boolean;
  dryRun?: boolean;
}

export interface EditDatabaseChapterInput {
  targetId?: string;
  accountId?: string;
  bookId?: string;
  localWorkId?: string | number;
  chapterId?: string | number;
  chapterNumber?: number;
  itemId?: string;
  title?: string;
  contentText?: string;
  headless?: boolean;
  dryRun?: boolean;
  requestId?: string;
}

export interface EditChapterResult {
  success: boolean;
  accountId: string;
  bookId: string;
  itemId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  listEntry?: Record<string, unknown> | null;
  verification?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface ValidateDatabaseChapterInput extends PublishDatabaseChapterInput {}

export interface ValidateDatabaseChapterResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolution: DatabasePublishResolution;
  remote: {
    latestChapterNumber: number;
    nextChapterNumber: number;
    chapterExists: boolean;
    itemId?: string;
  };
}

export interface CompareDatabaseChapterInput extends EditDatabaseChapterInput {}

export interface CompareDatabaseChapterResult {
  accountId: string;
  bookId: string;
  localWorkId: string;
  chapterNumber: number;
  itemId: string;
  titleMatched: boolean;
  contentMatched: boolean;
  database: DatabaseChapterForPublish;
  remote: RemoteChapterDetail;
  diff: {
    databaseTitle: string;
    remoteTitle: string;
    databaseContentLength: number;
    remoteContentLength: number;
    databaseWordCount?: number | null;
    remoteWordCount?: number;
  };
}

export interface FanqieClient {
  health(): Promise<HealthResult>;
  listAccounts(): Promise<FanqieAccount[]>;
  login(accountId: string): Promise<LoginResult>;
  loginDiscovered(): Promise<LoginResult>;
  checkSession(accountId: string): Promise<SessionCheckResult>;
  reauth(accountId: string): Promise<ReauthResult>;
  scanWorks(input: ScanWorksInput): Promise<RemoteWorkSnapshot[]>;
  syncRemoteChapters(input: SyncRemoteChaptersInput): Promise<RemoteChapterSnapshot[]>;
  getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail>;
  searchReaderBooks(input: ReaderSearchBooksInput): Promise<ReaderBookSummary[]>;
  getReaderBookDetail(bookIdOrUrl: string): Promise<ReaderBookDetail>;
  getReaderChapterDetail(itemIdOrUrl: string): Promise<ReaderChapterDetail>;
  exportReaderChapterText(input: ReaderChapterTextExportInput): Promise<ReaderChapterTextExport>;
  exportReaderBookText(input: ReaderBookTextExportInput): Promise<ReaderBookTextExport>;
  listDatabasePublicationTargets(input?: {
    platform?: string;
    accountIdentity?: string;
    localWorkId?: string | number;
    remoteWorkId?: string;
    limit?: number;
  }): Promise<DatabasePublicationTarget[]>;
  listDatabaseFanqieWorks(input?: {
    search?: string;
    accountId?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]>;
  syncDatabaseFanqieWorks(input: ScanWorksInput): Promise<DatabaseSyncFanqieWorksResult>;
  registerDatabasePublicationTarget(input: DatabaseRegisterPublicationTargetInput): Promise<DatabasePublicationTarget>;
  getDatabasePublishContext(input?: {
    targetId?: string;
    accountId?: string;
    bookId?: string;
    localWorkId?: string | number;
    limit?: number;
  }): Promise<DatabasePublishContext>;
  resolveDatabasePublishChapter(input: PublishDatabaseChapterInput): Promise<DatabasePublishResolution>;
  validateDatabasePublishChapter(input: ValidateDatabaseChapterInput): Promise<ValidateDatabaseChapterResult>;
  publishChapter(input: PublishChapterInput): Promise<PublishResult>;
  publishTomato(input: PublishChapterInput): Promise<PublishResult>;
  publishDatabaseChapter(input: PublishDatabaseChapterInput): Promise<PublishResult>;
  publishNextDatabaseChapter(input: PublishNextDatabaseChapterInput): Promise<PublishResult>;
  editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult>;
  editDatabaseChapter(input: EditDatabaseChapterInput): Promise<EditChapterResult>;
  compareDatabaseChapter(input: CompareDatabaseChapterInput): Promise<CompareDatabaseChapterResult>;
  getPublishJob(jobId: string): Promise<PublishJobStatus>;
}

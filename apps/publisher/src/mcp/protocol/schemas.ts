import * as z from 'zod/v4';

export const AccountIdSchema = z.string().min(1).describe('Stable Fanqie account id.');
export const BookIdSchema = z.string().min(1).describe('Fanqie platform book id.');
export const ChapterNumberSchema = z.number().int().positive().describe('Positive chapter number.');

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  aliases: z.array(z.string()),
  status: z.enum(['active', 'disabled']),
  cookiesStorageType: z.enum(['file', 'profile', 'external']),
  browserProfileKey: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AccountListOutputSchema = {
  accounts: z.array(AccountSchema),
};

export const AccountIdInputSchema = {
  accountId: AccountIdSchema,
};

export const LoginOutputSchema = {
  accountId: z.string(),
  status: z.enum(['started', 'completed', 'failed']),
  headed: z.boolean(),
  evidence: z.record(z.string(), z.unknown()).optional(),
};

export const SessionCheckOutputSchema = {
  accountId: z.string(),
  valid: z.boolean(),
  status: z.enum(['valid', 'expired', 'missing', 'unknown']),
  checkedAt: z.string(),
  evidence: z.record(z.string(), z.unknown()).optional(),
};

export const ReauthOutputSchema = {
  accountId: z.string(),
  status: z.enum(['valid', 'failed']),
  checkedAt: z.string(),
  before: z.object(SessionCheckOutputSchema),
  login: z.object(LoginOutputSchema).optional(),
  after: z.object(SessionCheckOutputSchema),
  evidence: z.record(z.string(), z.unknown()).optional(),
};

export const ScanWorksInputSchema = {
  accountId: z.string().optional(),
  headed: z.boolean().optional(),
};

export const RemoteWorkSnapshotSchema = z.object({
  accountId: z.string(),
  platform: z.literal('fanqie'),
  bookId: z.string(),
  title: z.string(),
  chapterCount: z.number().optional(),
  latestChapterNumber: z.number().optional(),
  scannedAt: z.string(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const ScanWorksOutputSchema = {
  works: z.array(RemoteWorkSnapshotSchema),
};

export const SyncRemoteChaptersInputSchema = {
  accountId: AccountIdSchema,
  bookId: BookIdSchema,
  refresh: z.boolean().optional(),
  persist: z.boolean().optional(),
};

export const RemoteChapterSnapshotSchema = z.object({
  accountId: z.string(),
  platform: z.literal('fanqie'),
  bookId: z.string(),
  itemId: z.string().optional(),
  chapterNumber: z.number(),
  title: z.string().optional(),
  wordCount: z.number().optional(),
  publishedAt: z.string().nullable().optional(),
  syncedAt: z.string(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const SyncRemoteChaptersOutputSchema = {
  chapters: z.array(RemoteChapterSnapshotSchema),
};

export const RemoteChapterIdentityInputSchema = {
  accountId: AccountIdSchema,
  bookId: BookIdSchema,
  itemId: z.string().min(1),
};

export const RemoteChapterDetailOutputSchema = {
  accountId: z.string().optional(),
  bookId: z.string(),
  itemId: z.string(),
  editUrl: z.string().optional(),
  chapterNumber: z.number().optional(),
  title: z.string(),
  contentHtml: z.string().optional(),
  contentText: z.string(),
  wordCount: z.number().optional(),
  responseCode: z.number().nullable().optional(),
  responseMessage: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
};

export const ReaderSearchBooksInputSchema = {
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).optional(),
};

export const ReaderBookSummarySchema = z.object({
  bookId: z.string(),
  title: z.string(),
  author: z.string().optional(),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  pageUrl: z.string(),
});

export const ReaderChapterOutlineSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  chapterNumber: z.number().optional(),
  volumeName: z.string().optional(),
  isLocked: z.boolean().optional(),
});

export const ReaderBookDetailSchema = ReaderBookSummarySchema.extend({
  category: z.string().optional(),
  status: z.string().optional(),
  wordCount: z.number().optional(),
  chapterTotal: z.number().optional(),
  lastChapterItemId: z.string().optional(),
  lastChapterTitle: z.string().optional(),
  abstract: z.string().optional(),
  chapters: z.array(ReaderChapterOutlineSchema),
});

export const ReaderChapterDetailSchema = z.object({
  itemId: z.string(),
  bookId: z.string(),
  title: z.string(),
  bookTitle: z.string().optional(),
  author: z.string().optional(),
  contentHtml: z.string(),
  contentText: z.string(),
  wordCount: z.number().optional(),
  prevItemId: z.string().optional(),
  nextItemId: z.string().optional(),
  updatedAtText: z.string().optional(),
  isLocked: z.boolean().optional(),
});

export const ReaderBookIdInputSchema = {
  bookId: z.string().min(1),
};

export const ReaderChapterIdInputSchema = {
  itemId: z.string().min(1),
};

export const ReaderChapterTextExportInputSchema = {
  itemId: z.string().min(1),
  includeMeta: z.boolean().optional(),
};

export const ReaderBookTextExportInputSchema = {
  bookId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).optional(),
  includeMeta: z.boolean().optional(),
};

export const ReaderChapterTextExportSchema = z.object({
  format: z.literal('txt'),
  filename: z.string(),
  itemId: z.string(),
  bookId: z.string(),
  title: z.string(),
  bookTitle: z.string().optional(),
  author: z.string().optional(),
  wordCount: z.number().optional(),
  content: z.string(),
});

export const ReaderBookTextExportSchema = z.object({
  format: z.literal('txt'),
  filename: z.string(),
  bookId: z.string(),
  title: z.string(),
  author: z.string().optional(),
  chapterCount: z.number(),
  exportedChapterCount: z.number(),
  skippedChapters: z.array(z.object({
    itemId: z.string(),
    title: z.string().optional(),
    error: z.string(),
  })),
  chapters: z.array(z.object({
    itemId: z.string(),
    title: z.string(),
    chapterNumber: z.number().optional(),
    wordCount: z.number().optional(),
  })),
  content: z.string(),
});

export const ReaderSearchBooksOutputSchema = {
  books: z.array(ReaderBookSummarySchema),
};

export const ReaderBookDetailOutputSchema = ReaderBookDetailSchema.shape;
export const ReaderChapterDetailOutputSchema = ReaderChapterDetailSchema.shape;
export const ReaderChapterTextExportOutputSchema = ReaderChapterTextExportSchema.shape;
export const ReaderBookTextExportOutputSchema = ReaderBookTextExportSchema.shape;

export const PublishChapterInputSchema = {
  accountId: AccountIdSchema,
  bookId: BookIdSchema,
  chapterNumber: ChapterNumberSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  idempotencyKey: z.string().optional(),
  headless: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  waitForCompletion: z.boolean().optional(),
  source: z.object({
    workId: z.union([z.string(), z.number()]).optional(),
    chapterId: z.union([z.string(), z.number()]).optional(),
    requestId: z.string().optional(),
  }).optional(),
};

export const PublishDatabaseChapterInputSchema = {
  targetId: z.string().optional(),
  accountId: z.string().optional(),
  bookId: z.string().optional(),
  localWorkId: z.union([z.string(), z.number()]).optional(),
  chapterId: z.union([z.string(), z.number()]).optional(),
  chapterNumber: ChapterNumberSchema.optional(),
  idempotencyKey: z.string().optional(),
  headless: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  waitForCompletion: z.boolean().optional(),
  requestId: z.string().optional(),
};

export const PublishNextDatabaseChapterInputSchema = {
  targetId: z.string().optional(),
  accountId: z.string().optional(),
  bookId: z.string().optional(),
  localWorkId: z.union([z.string(), z.number()]).optional(),
  dryRun: z.boolean().optional(),
  headless: z.boolean().optional(),
  waitForCompletion: z.boolean().optional(),
  requestId: z.string().optional(),
};

export const EditRemoteChapterInputSchema = {
  accountId: AccountIdSchema,
  bookId: BookIdSchema,
  itemId: z.string().min(1),
  title: z.string().optional(),
  contentText: z.string().optional(),
  headless: z.boolean().optional(),
  dryRun: z.boolean().optional(),
};

export const EditDatabaseChapterInputSchema = {
  targetId: z.string().optional(),
  accountId: z.string().optional(),
  bookId: z.string().optional(),
  localWorkId: z.union([z.string(), z.number()]).optional(),
  chapterId: z.union([z.string(), z.number()]).optional(),
  chapterNumber: ChapterNumberSchema.optional(),
  itemId: z.string().optional(),
  title: z.string().optional(),
  contentText: z.string().optional(),
  headless: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  requestId: z.string().optional(),
};

export const EditChapterResultOutputSchema = {
  success: z.boolean(),
  accountId: z.string(),
  bookId: z.string(),
  itemId: z.string(),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  listEntry: z.record(z.string(), z.unknown()).nullable().optional(),
  verification: z.record(z.string(), z.unknown()).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
};

export const PlatformConfirmationEvidenceSchema = z.object({
  platform: z.literal('fanqie'),
  accountId: z.string(),
  bookId: z.string(),
  chapterNumber: z.number(),
  confirmed: z.boolean(),
  confirmedAt: z.string(),
  evidence: z.record(z.string(), z.unknown()),
});

export const PublishResultOutputSchema = {
  jobId: z.string(),
  accepted: z.boolean(),
  completed: z.boolean(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  confirmation: PlatformConfirmationEvidenceSchema.optional(),
  error: z.string().optional(),
};

export const PublishJobInputSchema = {
  jobId: z.string().min(1),
};

export const PublishJobOutputSchema = {
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  accountId: z.string(),
  bookId: z.string(),
  chapterNumber: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  dryRun: z.boolean(),
  result: PlatformConfirmationEvidenceSchema.optional(),
  error: z.string().optional(),
};

export const DatabasePublicationTargetsInputSchema = {
  platform: z.string().optional(),
  accountIdentity: z.string().optional(),
  localWorkId: z.union([z.string(), z.number()]).optional(),
  remoteWorkId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
};

export const DatabaseFanqieWorksInputSchema = {
  search: z.string().optional(),
  accountId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
};

export const DatabasePublishContextInputSchema = {
  targetId: z.string().optional(),
  accountId: z.string().optional(),
  bookId: z.string().optional(),
  localWorkId: z.union([z.string(), z.number()]).optional(),
  limit: z.number().int().positive().max(500).optional(),
};

export const DatabasePublicationTargetSchema = z.object({
  id: z.string(),
  platform: z.string(),
  accountIdentity: z.string(),
  localWorkId: z.string(),
  remoteWorkId: z.string().nullable().optional(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();

export const DatabasePublicationTargetsOutputSchema = {
  publicationTargets: z.array(DatabasePublicationTargetSchema),
};

export const DatabaseFanqieWorksOutputSchema = {
  fanqieWorks: z.array(z.record(z.string(), z.unknown())),
};

export const DatabaseSyncFanqieWorksOutputSchema = {
  syncedAt: z.string(),
  count: z.number(),
  works: z.array(z.object({
    id: z.number(),
    accountId: z.string(),
    bookId: z.string(),
    title: z.string(),
    action: z.enum(['inserted', 'updated']),
  })),
};

export const DatabaseRegisterPublicationTargetInputSchema = {
  targetId: z.string().optional(),
  accountId: z.string().optional(),
  accountIdentity: z.string().optional(),
  bookId: z.string().optional(),
  remoteWorkId: z.string().optional(),
  localWorkId: z.union([z.string(), z.number()]),
  title: z.string().optional(),
  author: z.string().nullable().optional(),
  status: z.enum(['active', 'paused', 'retired']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const DatabasePublishContextOutputSchema = {
  accountId: z.string().optional(),
  bookId: z.string().optional(),
  localWorkId: z.string().optional(),
  publicationTargets: z.array(DatabasePublicationTargetSchema),
  fanqieWorks: z.array(z.record(z.string(), z.unknown())),
  matchedTarget: DatabasePublicationTargetSchema.optional(),
  matchedFanqieWork: z.record(z.string(), z.unknown()).optional(),
};

const DatabaseChapterForPublishSchema = z.object({
  id: z.string(),
  workId: z.string(),
  volumeNumber: z.number().nullable().optional(),
  chapterNumber: z.number(),
  title: z.string(),
  content: z.string(),
  wordCount: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  auditStatus: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
});

export const DatabasePublishResolutionOutputSchema = {
  accountId: z.string(),
  bookId: z.string(),
  localWorkId: z.string(),
  chapter: DatabaseChapterForPublishSchema,
  context: z.object(DatabasePublishContextOutputSchema),
  publishInput: z.object(PublishChapterInputSchema),
};

export const ValidateDatabaseChapterOutputSchema = {
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  resolution: z.object(DatabasePublishResolutionOutputSchema),
  remote: z.object({
    latestChapterNumber: z.number(),
    nextChapterNumber: z.number(),
    chapterExists: z.boolean(),
    itemId: z.string().optional(),
  }),
};

export const CompareDatabaseChapterOutputSchema = {
  accountId: z.string(),
  bookId: z.string(),
  localWorkId: z.string(),
  chapterNumber: z.number(),
  itemId: z.string(),
  titleMatched: z.boolean(),
  contentMatched: z.boolean(),
  database: DatabaseChapterForPublishSchema,
  remote: z.object(RemoteChapterDetailOutputSchema),
  diff: z.object({
    databaseTitle: z.string(),
    remoteTitle: z.string(),
    databaseContentLength: z.number(),
    remoteContentLength: z.number(),
    databaseWordCount: z.number().nullable().optional(),
    remoteWordCount: z.number().optional(),
  }),
};

export const PublishStepInputSchema = {
  accountId: AccountIdSchema,
  bookId: BookIdSchema,
  chapterNumber: ChapterNumberSchema.optional(),
  title: z.string().optional(),
  content: z.string().optional(),
};

export const PublishStepOutputSchema = {
  ok: z.boolean(),
  step: z.enum(['open_work', 'upload_chapter', 'submit_publish', 'check_publish_result']),
  evidence: z.record(z.string(), z.unknown()),
};

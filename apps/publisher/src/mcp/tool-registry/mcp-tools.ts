import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FanqieServiceContainer } from '../../container.js';
import { FanqieServiceError } from '../../sdk/errors.js';
import {
  AccountIdInputSchema,
  AccountListOutputSchema,
  DatabaseFanqieWorksInputSchema,
  DatabaseFanqieWorksOutputSchema,
  DatabasePublicationTargetSchema,
  DatabasePublicationTargetsInputSchema,
  DatabasePublicationTargetsOutputSchema,
  DatabasePublishContextInputSchema,
  DatabasePublishContextOutputSchema,
  DatabasePublishResolutionOutputSchema,
  DatabaseRegisterPublicationTargetInputSchema,
  DatabaseSyncFanqieWorksOutputSchema,
  CompareDatabaseChapterOutputSchema,
  EditChapterResultOutputSchema,
  EditDatabaseChapterInputSchema,
  EditRemoteChapterInputSchema,
  LoginOutputSchema,
  PublishChapterInputSchema,
  PublishDatabaseChapterInputSchema,
  PublishJobInputSchema,
  PublishJobOutputSchema,
  PublishNextDatabaseChapterInputSchema,
  PublishResultOutputSchema,
  ValidateDatabaseChapterOutputSchema,
  ReaderBookDetailOutputSchema,
  ReaderBookIdInputSchema,
  ReaderBookTextExportInputSchema,
  ReaderBookTextExportOutputSchema,
  ReaderChapterDetailOutputSchema,
  ReaderChapterIdInputSchema,
  ReaderChapterTextExportInputSchema,
  ReaderChapterTextExportOutputSchema,
  ReaderSearchBooksInputSchema,
  ReaderSearchBooksOutputSchema,
  ReauthOutputSchema,
  RemoteChapterDetailOutputSchema,
  RemoteChapterIdentityInputSchema,
  ScanWorksInputSchema,
  ScanWorksOutputSchema,
  SessionCheckOutputSchema,
  SyncRemoteChaptersInputSchema,
  SyncRemoteChaptersOutputSchema,
} from '../protocol/schemas.js';

export function registerFanqieTools(server: McpServer, container: FanqieServiceContainer) {
  server.registerTool('account.list', {
    title: 'List Fanqie Accounts',
    description: 'List Fanqie accounts known by the platform execution runtime.',
    inputSchema: {},
    outputSchema: AccountListOutputSchema,
    annotations: { readOnlyHint: true },
  }, async () => structured({ accounts: await container.accounts.listAccounts() }));

  server.registerTool('account.login', {
    title: 'Launch Login',
    description: 'Launch or continue Fanqie login for an account through the browser runtime.',
    inputSchema: AccountIdInputSchema,
    outputSchema: LoginOutputSchema,
  }, async ({ accountId }) => structured(await container.sessions.login(accountId)));

  server.registerTool('account.login.discover', {
    title: 'Login And Discover Account',
    description: 'Open the Fanqie login page, let the operator log in, identify the logged-in account from the browser session, persist cookies to DataBase, and close the browser.',
    inputSchema: {},
    outputSchema: LoginOutputSchema,
  }, async () => structured(await container.sessions.loginDiscovered()));

  server.registerTool('account.session.check', {
    title: 'Check Session',
    description: 'Check whether a Fanqie account session is usable.',
    inputSchema: AccountIdInputSchema,
    outputSchema: SessionCheckOutputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ accountId }) => structured(await container.sessions.checkSession(accountId)));

  server.registerTool('account.reauth', {
    title: 'Reauthenticate Account',
    description: 'Check a Fanqie account session, run a headed login to completion when needed, persist cookies, and verify the session again.',
    inputSchema: AccountIdInputSchema,
    outputSchema: ReauthOutputSchema,
  }, async ({ accountId }) => structured(await container.sessions.reauth(accountId)));

  server.registerTool('work.scan', {
    title: 'Scan Remote Works',
    description: 'Scan remote Fanqie works and return structured snapshots.',
    inputSchema: ScanWorksInputSchema,
    outputSchema: ScanWorksOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured({ works: await container.scan.scanWorks(input) }));

  server.registerTool('chapter.remote.sync', {
    title: 'Sync Remote Chapters',
    description: 'Read remote Fanqie chapter snapshots for a book.',
    inputSchema: SyncRemoteChaptersInputSchema,
    outputSchema: SyncRemoteChaptersOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured({ chapters: await container.scan.syncRemoteChapters(input) }));

  server.registerTool('publish.chapter', {
    title: 'Publish Chapter',
    description: 'Compatibility command that executes the full Fanqie publish flow and returns job evidence.',
    inputSchema: PublishChapterInputSchema,
    outputSchema: PublishResultOutputSchema,
    annotations: { destructiveHint: true },
  }, async (input) => structured(await container.publish.publishChapter(input)));

  server.registerTool('publish.database.chapter', {
    title: 'Publish DataBase Chapter',
    description: 'Resolve one DataBase chapter and execute one atomic Fanqie publish. Eligibility decisions must be made by the caller.',
    inputSchema: PublishDatabaseChapterInputSchema,
    outputSchema: PublishResultOutputSchema,
    annotations: { destructiveHint: true },
  }, async (input) => {
    const resolved = await container.database.resolvePublishChapter(input);
    const result = await container.publish.publishChapter(resolved.publishInput);
    await recordPublishResult(container, resolved, result, input);
    return structured(result);
  });

  server.registerTool('publish.database.chapter.validate', {
    title: 'Validate DataBase Chapter Publish',
    description: 'Resolve a DataBase chapter and compare it with remote chapter state before publishing.',
    inputSchema: PublishDatabaseChapterInputSchema,
    outputSchema: ValidateDatabaseChapterOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.publishPlanning.validateDatabaseChapter(input)));

  server.registerTool('publish.next.database.chapter', {
    title: 'Publish Next DataBase Chapter',
    description: 'Resolve publication context, read remote latest chapter number, and publish the next DataBase chapter.',
    inputSchema: PublishNextDatabaseChapterInputSchema,
    outputSchema: PublishResultOutputSchema,
    annotations: { destructiveHint: true },
  }, async (input) => {
    const context = await container.database.getPublishContext(input);
    const accountId = required(context.accountId || input.accountId, 'accountId');
    const bookId = required(context.bookId || input.bookId, 'bookId');
    const localWorkId = required(context.localWorkId || input.localWorkId, 'localWorkId');
    const chapters = await container.scan.syncRemoteChapters({
      accountId,
      bookId,
      refresh: true,
      persist: false,
    });
    const latest = chapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapterNumber || 0)), 0);
    const resolved = await container.database.resolvePublishChapter({
      ...input,
      accountId,
      bookId,
      localWorkId,
      chapterNumber: latest + 1,
    });
    const result = await container.publish.publishChapter(resolved.publishInput);
    await recordPublishResult(container, resolved, result, input);
    return structured(result);
  });

  server.registerTool('publish.job.get', {
    title: 'Get Publish Job',
    description: 'Read publish job status and confirmation evidence.',
    inputSchema: PublishJobInputSchema,
    outputSchema: PublishJobOutputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ jobId }) => {
    const job = await container.publish.getPublishJob(jobId);
    if (!job) throw new FanqieServiceError('publish_job_not_found', 'publish job not found', 404);
    return structured(job);
  });

  server.registerTool('remote.chapter.get', {
    title: 'Get Remote Chapter Detail',
    description: 'Read one Fanqie remote chapter detail through the browser runtime.',
    inputSchema: RemoteChapterIdentityInputSchema,
    outputSchema: RemoteChapterDetailOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.edit.getRemoteChapter(input)));

  server.registerTool('remote.chapter.edit', {
    title: 'Edit Remote Chapter',
    description: 'Update one existing Fanqie remote chapter by itemId.',
    inputSchema: EditRemoteChapterInputSchema,
    outputSchema: EditChapterResultOutputSchema,
    annotations: { destructiveHint: true },
  }, async (input) => structured(await container.edit.editRemoteChapter(input)));

  server.registerTool('database.chapter.edit', {
    title: 'Edit Remote Chapter From DataBase',
    description: 'Resolve one DataBase chapter and update the matching Fanqie remote chapter.',
    inputSchema: EditDatabaseChapterInputSchema,
    outputSchema: EditChapterResultOutputSchema,
    annotations: { destructiveHint: true },
  }, async (input) => {
    const resolved = await container.database.resolvePublishChapter(input);
    const chapters = await container.scan.syncRemoteChapters({
      accountId: resolved.accountId,
      bookId: resolved.bookId,
      refresh: true,
      persist: false,
    });
    const chapter = chapters.find((item) => Number(item.chapterNumber) === Number(resolved.chapter.chapterNumber));
    if (!chapter || !chapter.itemId) throw new FanqieServiceError('remote_chapter_not_found', 'remote chapter itemId not found', 404);
    const result = await container.edit.editRemoteChapter({
      accountId: resolved.accountId,
      bookId: resolved.bookId,
      itemId: input.itemId || chapter.itemId,
      title: input.title || resolved.chapter.title,
      contentText: input.contentText || resolved.chapter.content,
      headless: input.headless,
      dryRun: input.dryRun,
    });
    await recordEditResult(container, resolved, result, input);
    return structured(result);
  });

  server.registerTool('database.chapter.compare', {
    title: 'Compare DataBase Chapter With Remote',
    description: 'Read the DataBase chapter and matching Fanqie remote chapter, then return title/content match status.',
    inputSchema: EditDatabaseChapterInputSchema,
    outputSchema: CompareDatabaseChapterOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.publishPlanning.compareDatabaseChapter(input)));

  server.registerTool('reader.book.search', {
    title: 'Search Public Fanqie Books',
    description: 'Search public Fanqie reader pages. Direct book ids and page URLs resolve deterministically; text search is best-effort.',
    inputSchema: ReaderSearchBooksInputSchema,
    outputSchema: ReaderSearchBooksOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured({ books: await container.reader.searchBooks(input) }));

  server.registerTool('reader.book.get', {
    title: 'Get Public Fanqie Book',
    description: 'Read public Fanqie book metadata and chapter outline from the public reader surface.',
    inputSchema: ReaderBookIdInputSchema,
    outputSchema: ReaderBookDetailOutputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ bookId }) => structured(await container.reader.getBookDetail(bookId)));

  server.registerTool('reader.chapter.get', {
    title: 'Get Public Fanqie Chapter',
    description: 'Read public Fanqie chapter metadata and unobfuscated text content.',
    inputSchema: ReaderChapterIdInputSchema,
    outputSchema: ReaderChapterDetailOutputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ itemId }) => structured(await container.reader.getChapterDetail(itemId)));

  server.registerTool('reader.chapter.export.text', {
    title: 'Export Public Chapter Text',
    description: 'Return one public Fanqie chapter as TXT content without writing a file.',
    inputSchema: ReaderChapterTextExportInputSchema,
    outputSchema: ReaderChapterTextExportOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.reader.exportChapterText(input)));

  server.registerTool('reader.book.export.text', {
    title: 'Export Public Book Text',
    description: 'Return selected public Fanqie chapters as one TXT payload without writing a file.',
    inputSchema: ReaderBookTextExportInputSchema,
    outputSchema: ReaderBookTextExportOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.reader.exportBookText(input)));

  server.registerTool('database.publication.targets', {
    title: 'List DataBase Publication Targets',
    description: 'Read canonical publication target mappings from DataBase through the DataBase SDK.',
    inputSchema: DatabasePublicationTargetsInputSchema,
    outputSchema: DatabasePublicationTargetsOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured({
    publicationTargets: await container.database.listPublicationTargets({
      ...input,
      localWorkId: input.localWorkId == null ? undefined : String(input.localWorkId),
    }),
  }));

  server.registerTool('database.fanqie.works', {
    title: 'List DataBase Fanqie Works',
    description: 'Read Fanqie work records from DataBase through the DataBase SDK.',
    inputSchema: DatabaseFanqieWorksInputSchema,
    outputSchema: DatabaseFanqieWorksOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured({
    fanqieWorks: await container.database.listFanqieWorks(input),
  }));

  server.registerTool('database.fanqie.works.sync', {
    title: 'Sync DataBase Fanqie Works',
    description: 'Scan Fanqie backstage through the browser runtime and upsert remote work snapshots into DataBase.',
    inputSchema: ScanWorksInputSchema,
    outputSchema: DatabaseSyncFanqieWorksOutputSchema,
  }, async (input) => {
    const works = await container.scan.scanWorks(input);
    return structured(await container.database.syncFanqieWorks(works));
  });

  server.registerTool('database.publication.target.register', {
    title: 'Register DataBase Publication Target',
    description: 'Bind one DataBase local work to one Fanqie remote book as the canonical publication target.',
    inputSchema: DatabaseRegisterPublicationTargetInputSchema,
    outputSchema: DatabasePublicationTargetSchema.shape,
  }, async (input) => structured(await container.database.registerPublicationTarget(input)));

  server.registerTool('database.publish.context', {
    title: 'Resolve DataBase Publish Context',
    description: 'Resolve account, local work, and Fanqie book mapping from DataBase through the DataBase SDK.',
    inputSchema: DatabasePublishContextInputSchema,
    outputSchema: DatabasePublishContextOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.database.getPublishContext(input)));

  server.registerTool('database.publish.chapter', {
    title: 'Resolve DataBase Publish Chapter',
    description: 'Resolve account, Fanqie book, and DataBase chapter body without publishing.',
    inputSchema: PublishDatabaseChapterInputSchema,
    outputSchema: DatabasePublishResolutionOutputSchema,
    annotations: { readOnlyHint: true },
  }, async (input) => structured(await container.database.resolvePublishChapter(input)));
}

function structured<T extends object>(value: T) {
  const structuredContent = { ...(value as Record<string, unknown>) };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function required(value: unknown, field: string): string {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new FanqieServiceError('database_publish_context_incomplete', `${field} is required`, 422);
  return text;
}

async function recordPublishResult(
  container: FanqieServiceContainer,
  resolved: Awaited<ReturnType<FanqieServiceContainer['database']['resolvePublishChapter']>>,
  result: Awaited<ReturnType<FanqieServiceContainer['publish']['publishChapter']>>,
  input: Record<string, unknown>,
) {
  if (resolved.publishInput.dryRun === true) return;
  if (result.status !== 'succeeded') return;
  if (!result.confirmation) return;
  const evidence = result.confirmation.evidence;
  const evidenceRecord = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence as Record<string, unknown>
    : {};
  const matched = evidenceRecord.matchedChapter;
  const matchedRecord = matched && typeof matched === 'object' && !Array.isArray(matched)
    ? matched as Record<string, unknown>
    : {};
  const itemId = matchedRecord.itemId == null ? undefined : String(matchedRecord.itemId);
  await container.database.recordPublicationResult({
    targetId: typeof input.targetId === 'string' && input.targetId.trim() ? input.targetId.trim() : undefined,
    accountId: resolved.accountId,
    bookId: resolved.bookId,
    localWorkId: resolved.localWorkId,
    chapterId: resolved.chapter.id,
    chapterNumber: resolved.chapter.chapterNumber,
    contentPartId: `legacy_chapter_${resolved.chapter.id}`,
    action: 'publish_chapter',
    remotePartId: itemId,
    observedStatus: result.confirmation.confirmed ? 'published' : 'submitted',
    publishedAt: result.confirmation.confirmedAt,
    result: {
      jobId: result.jobId,
      confirmation: result.confirmation,
    },
  });
}

async function recordEditResult(
  container: FanqieServiceContainer,
  resolved: Awaited<ReturnType<FanqieServiceContainer['database']['resolvePublishChapter']>>,
  result: Awaited<ReturnType<FanqieServiceContainer['edit']['editRemoteChapter']>>,
  input: Record<string, unknown>,
) {
  if (input.dryRun === true) return;
  if (result.success !== true) return;
  await container.database.recordPublicationResult({
    targetId: typeof input.targetId === 'string' && input.targetId.trim() ? input.targetId.trim() : undefined,
    accountId: resolved.accountId,
    bookId: resolved.bookId,
    localWorkId: resolved.localWorkId,
    chapterId: resolved.chapter.id,
    chapterNumber: resolved.chapter.chapterNumber,
    contentPartId: `legacy_chapter_${resolved.chapter.id}`,
    action: 'edit_chapter',
    remotePartId: result.itemId,
    observedStatus: 'edited',
    publishedAt: new Date().toISOString(),
    result: {
      editResult: result,
    },
  });
}

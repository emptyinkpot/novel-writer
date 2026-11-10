import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/http/createApp.js';
import { FANQIE_HTTP_ROUTES } from '../src/api/protocol/http-contract.js';
import { createContainer } from '../src/container.js';
import { AccountService } from '../src/application/account/AccountService.js';
import { PublishService } from '../src/application/publish/PublishService.js';
import { PublishPlanningService } from '../src/application/publish/PublishPlanningService.js';
import { EditService } from '../src/application/edit/EditService.js';
import { RemoteScanService } from '../src/application/scan/RemoteScanService.js';
import { SessionService } from '../src/application/account/SessionService.js';
import type { PublicReaderService } from '../src/application/reader/PublicReaderService.js';
import { NotConfiguredFanqiePlatformDriver, type FanqiePlatformDriver } from '../src/drivers/fanqie/FanqiePlatformDriver.js';
import { ScriptFanqiePlatformDriver } from '../src/drivers/fanqie/ScriptFanqiePlatformDriver.js';
import { InMemoryPublishJobRepository } from '../src/runtime/queue/InMemoryPublishJobRepository.js';
import { AccountLock } from '../src/runtime/locks/AccountLock.js';
import { HttpFanqieClient } from '../src/sdk/client.js';
import type { DataBasePublicationClient } from '../src/infrastructure/database/DataBasePublicationClient.js';
import type {
  EditChapterResult,
  EditRemoteChapterInput,
  LoginResult,
  PlatformConfirmationEvidence,
  PublishChapterInput,
  RemoteChapterDetail,
  RemoteChapterSnapshot,
  RemoteWorkSnapshot,
  ReaderBookDetail,
  ReaderChapterDetail,
  SessionCheckResult,
} from '../src/sdk/types.js';

test('service exposes health, account persistence, publish jobs, and explicit driver failures', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-service-test-'));
  const driver = new NotConfiguredFanqiePlatformDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const health = await client.health();
    assert.equal(health.ok, true);
    assert.equal(health.driver.configured, false);
    assert.equal(typeof client.accounts.list, 'function');
    assert.equal(typeof client.accounts.reauth, 'function');
    assert.equal(typeof client.accounts.loginDiscovered, 'function');
    assert.equal(typeof client.library.getRemoteChapter, 'function');
    assert.equal(typeof client.database.resolvePublishChapter, 'function');
    assert.equal(typeof client.database.validatePublishChapter, 'function');
    assert.equal(typeof client.publish.tomato, 'function');
    assert.equal(typeof client.publish.nextDatabaseChapter, 'function');
    assert.equal(typeof client.edit.databaseChapter, 'function');
    assert.equal(typeof client.edit.compareDatabaseChapter, 'function');
    assert.equal(typeof client.reader.getBookDetail, 'function');

    assert.deepEqual((await client.accounts.list()).map((item) => item.id), ['fanqie_main']);

    const dryRun = await client.publishChapter({
      accountId: 'fanqie_main',
      bookId: 'book_1',
      chapterNumber: 1,
      title: '第一章',
      content: '正文内容',
      dryRun: true,
    });
    assert.equal(dryRun.completed, true);
    assert.equal(dryRun.status, 'succeeded');
    const job = await client.getPublishJob(dryRun.jobId);
    assert.equal(job.status, 'succeeded');

    const tomatoDryRun = await client.publish.tomato({
      accountId: 'fanqie_main',
      bookId: 'book_1',
      chapterNumber: 2,
      title: '第二章',
      content: '番茄发布正文',
      dryRun: true,
    });
    assert.equal(tomatoDryRun.completed, true);
    assert.equal(tomatoDryRun.status, 'succeeded');

    const publishContext = await client.getDatabasePublishContext({
      targetId: 'target_1',
    });
    assert.equal(publishContext.accountId, 'fanqie_main');
    assert.equal(publishContext.bookId, 'book_1');
    assert.ok(publishContext.publicationTargets[0]);
    assert.equal(publishContext.publicationTargets[0].remoteWorkId, 'book_1');
    const resolved = await client.resolveDatabasePublishChapter({
      targetId: 'target_1',
      chapterNumber: 1,
    });
    assert.equal(resolved.publishInput.accountId, 'fanqie_main');
    assert.equal(resolved.publishInput.bookId, 'book_1');
    assert.equal(resolved.publishInput.chapterNumber, 1);
    assert.equal(resolved.publishInput.content, '正文内容');

    const readerBook = await client.reader.getBookDetail('reader_book_1');
    assert.equal(readerBook.title, '公共作品');
    assert.ok(readerBook.chapters[0]);
    assert.equal(readerBook.chapters[0].itemId, 'reader_item_1');
    const chapterText = await client.reader.exportChapterText({
      itemId: 'reader_item_1',
      includeMeta: false,
    });
    assert.equal(chapterText.filename, '公共作品-第一章-reader_item_1.txt');
    assert.equal(chapterText.content, '公共正文');

    await assert.rejects(() => client.checkSession('fanqie_main'), /driver is not configured/);
    await assert.rejects(() => client.reauth('fanqie_main'), /driver is not configured/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('account reauth waits for login completion and verifies the refreshed session', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-reauth-test-'));
  const driver = new ReauthRecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const result = await client.reauth('fanqie_main');

    assert.equal(result.status, 'valid');
    assert.equal(result.before.status, 'expired');
    assert.equal(result.login?.status, 'completed');
    assert.equal(result.after.status, 'valid');
    assert.deepEqual(driver.loginOptions, [{ waitForCompletion: true }]);
    assert.equal(driver.checkCount, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('account login discovery does not require a preselected account id', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-login-discovery-test-'));
  const driver = new LoginDiscoveryRecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const result = await client.loginDiscovered();

    assert.equal(result.status, 'completed');
    assert.equal(result.accountId, 'fanqie_discovered');
    assert.equal(driver.discoveryLoginCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createFakeDatabaseClient(): DataBasePublicationClient {
  const records: any[] = [];
  return {
    records,
    listPublicationTargets: async () => [{
      id: 'target_1',
      platform: 'fanqie',
      accountIdentity: 'fanqie_main',
      localWorkId: 'work_1',
      remoteWorkId: 'book_1',
      status: 'active',
      metadata: {},
    }],
    listFanqieWorks: async () => [{
      account_id: 'fanqie_main',
      work_id: 'book_1',
      title: 'Test Book',
    }],
    syncFanqieWorks: async (works: RemoteWorkSnapshot[]) => ({
      syncedAt: new Date(0).toISOString(),
      count: works.length,
      works: works.map((work, index) => ({
        id: index + 1,
        accountId: work.accountId,
        bookId: work.bookId,
        title: work.title,
        action: 'updated' as const,
      })),
    }),
    syncFanqieRemoteChapters: async (input: { accountId: string; bookId: string; chapters: RemoteChapterSnapshot[] }) => ({
      accountId: input.accountId,
      bookId: input.bookId,
      chapterCount: input.chapters.length,
      syncedAt: new Date(0).toISOString(),
    }),
    getPublishContext: async (query: any = {}) => ({
      accountId: query.accountId || 'fanqie_main',
      bookId: query.bookId || 'book_1',
      localWorkId: String(query.localWorkId || 'work_1'),
      publicationTargets: [{
        id: 'target_1',
        platform: 'fanqie',
        accountIdentity: 'fanqie_main',
        localWorkId: 'work_1',
        remoteWorkId: 'book_1',
        status: 'active',
        metadata: {},
      }],
      fanqieWorks: [{
        account_id: 'fanqie_main',
        work_id: 'book_1',
        title: 'Test Book',
      }],
    }),
    resolvePublishChapter: async (input: any) => ({
      accountId: input.accountId || 'fanqie_main',
      bookId: input.bookId || 'book_1',
      localWorkId: String(input.localWorkId || 'work_1'),
      chapter: {
        id: 'chapter_1',
        workId: String(input.localWorkId || 'work_1'),
        volumeNumber: 1,
        chapterNumber: Number(input.chapterNumber || 1),
        title: '第一章',
        content: '正文内容',
        wordCount: 4,
        status: 'audited',
        auditStatus: 'pass',
        publishedAt: null,
      },
      context: {
        accountId: input.accountId || 'fanqie_main',
        bookId: input.bookId || 'book_1',
        localWorkId: String(input.localWorkId || 'work_1'),
        publicationTargets: [],
        fanqieWorks: [],
      },
      publishInput: {
        accountId: input.accountId || 'fanqie_main',
        bookId: input.bookId || 'book_1',
        chapterNumber: Number(input.chapterNumber || 1),
        title: '第一章',
        content: '正文内容',
        waitForCompletion: input.waitForCompletion,
        dryRun: input.dryRun,
        source: {
          workId: input.localWorkId || 'work_1',
          chapterId: 'chapter_1',
          requestId: input.requestId,
        },
      },
    }),
    recordPublicationResult: async (input: any) => {
      records.push(input);
      return {
        recordId: `record_${records.length}`,
        targetId: input.targetId || 'target_1',
        contentPartId: input.contentPartId || null,
        chapterId: Number(input.chapterId || 0) || null,
        chapterNumber: Number(input.chapterNumber),
        action: input.action,
        remotePartId: input.remotePartId || null,
        observedStatus: input.observedStatus,
        chapterStatus: input.observedStatus === 'published' || input.observedStatus === 'edited' ? 'published' : null,
        contentPartStatus: input.observedStatus === 'published' || input.observedStatus === 'edited' ? 'published' : null,
      };
    },
    listFanqieAccounts: async () => [{
      id: 'fanqie_main',
      name: 'main',
      aliases: [],
      status: 'active',
      cookiesStorageType: 'external',
      meta: { source: 'database' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }],
  } as unknown as DataBasePublicationClient;
}

function createFakeReaderService(): PublicReaderService {
  const book: ReaderBookDetail = {
    bookId: 'reader_book_1',
    title: '公共作品',
    author: '公共作者',
    pageUrl: 'https://fanqienovel.com/page/reader_book_1',
    chapterTotal: 1,
    chapters: [{
      itemId: 'reader_item_1',
      title: '第一章',
      chapterNumber: 1,
    }],
  };
  const chapter: ReaderChapterDetail = {
    itemId: 'reader_item_1',
    bookId: 'reader_book_1',
    title: '第一章',
    bookTitle: '公共作品',
    author: '公共作者',
    contentHtml: '<p>公共正文</p>',
    contentText: '公共正文',
    wordCount: 4,
  };
  return {
    searchBooks: async () => [{
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      pageUrl: book.pageUrl,
    }],
    getBookDetail: async () => book,
    getChapterDetail: async () => chapter,
    exportChapterText: async (input: { includeMeta?: boolean }) => ({
      format: 'txt',
      filename: '公共作品-第一章-reader_item_1.txt',
      itemId: chapter.itemId,
      bookId: chapter.bookId,
      title: chapter.title,
      bookTitle: chapter.bookTitle,
      author: chapter.author,
      wordCount: chapter.wordCount,
      content: input.includeMeta === false ? chapter.contentText : `公共作品\n作者：公共作者\n第一章\n\n${chapter.contentText}`,
    }),
    exportBookText: async () => ({
      format: 'txt',
      filename: '公共作品-reader_book_1.txt',
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      chapterCount: 1,
      exportedChapterCount: 1,
      skippedChapters: [],
      chapters: [{
        itemId: chapter.itemId,
        title: chapter.title,
        chapterNumber: 1,
        wordCount: chapter.wordCount,
      }],
      content: `公共作品\n\n${chapter.contentText}`,
    }),
  } as unknown as PublicReaderService;
}

test('database chapter publish resolves DB chapter and delegates one atomic publish', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-db-publish-test-'));
  const driver = new RecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const result = await client.publishDatabaseChapter({
      accountId: 'fanqie_main',
      bookId: 'book_1',
      localWorkId: 'work_1',
      chapterNumber: 1,
      waitForCompletion: true,
    });

    assert.equal(result.status, 'succeeded');
    assert.ok(driver.lastPublish);
    assert.equal(driver.lastPublish.accountId, 'fanqie_main');
    assert.ok(driver.lastPublish);
    assert.equal(driver.lastPublish.bookId, 'book_1');
    assert.ok(driver.lastPublish);
    assert.equal(driver.lastPublish.chapterNumber, 1);
    assert.ok(driver.lastPublish);
    assert.equal(driver.lastPublish.title, '第一章');
    assert.ok(driver.lastPublish);
    assert.equal(driver.lastPublish.content, '正文内容');
    assert.equal((database as any).records.length, 1);
    assert.equal((database as any).records[0].action, 'publish_chapter');
    assert.equal((database as any).records[0].observedStatus, 'published');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('database chapter edit resolves DB chapter, remote item id, and delegates edit', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-db-edit-test-'));
  const driver = new RecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const result = await client.edit.databaseChapter({
      accountId: 'fanqie_main',
      bookId: 'book_1',
      localWorkId: 'work_1',
      chapterNumber: 1,
    });

    assert.equal(result.success, true);
    assert.equal(result.itemId, 'item_1');
    assert.ok(driver.lastEdit);
    assert.equal(driver.lastEdit.accountId, 'fanqie_main');
    assert.ok(driver.lastEdit);
    assert.equal(driver.lastEdit.bookId, 'book_1');
    assert.ok(driver.lastEdit);
    assert.equal(driver.lastEdit.itemId, 'item_1');
    assert.ok(driver.lastEdit);
    assert.equal(driver.lastEdit.title, '第一章');
    assert.ok(driver.lastEdit);
    assert.equal(driver.lastEdit.contentText, '正文内容');
    assert.equal((database as any).records.length, 1);
    assert.equal((database as any).records[0].action, 'edit_chapter');
    assert.equal((database as any).records[0].observedStatus, 'edited');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('database chapter edit supports dry-run preview without submitting remote edit', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-db-edit-dry-run-test-'));
  const driver = new RecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const result = await client.edit.databaseChapter({
      accountId: 'fanqie_main',
      bookId: 'book_1',
      localWorkId: 'work_1',
      chapterNumber: 1,
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.itemId, 'item_1');
    assert.ok(result.verification);
    assert.equal(result.verification.dryRun, true);
    assert.ok(result.verification);
    assert.equal(result.verification.wouldChangeTitle, false);
    assert.equal(driver.lastEdit, null);
    assert.equal(driver.remoteDetailReads, 1);
    assert.equal((database as any).records.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('next database chapter publish resolves latest remote number on the server', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-next-publish-test-'));
  const driver = new RecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const result = await client.publish.nextDatabaseChapter({
      targetId: 'target_1',
      dryRun: true,
      waitForCompletion: true,
    });

    assert.equal(result.status, 'succeeded');
    assert.ok(result.confirmation);
    assert.equal(result.confirmation.chapterNumber, 2);
    assert.ok(result.confirmation);
    assert.equal(result.confirmation.evidence.dryRun, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('database chapter validation and compare expose safe preflight APIs', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-db-preflight-test-'));
  const driver = new RecordingDriver();
  const database = createFakeDatabaseClient();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database);
  const publish = new PublishService(driver, new InMemoryPublishJobRepository());
  const edit = new EditService(driver);
  const app = createApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    },
    driver,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning: new PublishPlanningService(database, scan, edit),
    edit,
    reader: createFakeReaderService(),
    database,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    const client = new HttpFanqieClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    const validation = await client.validateDatabasePublishChapter({
      targetId: 'target_1',
      chapterNumber: 2,
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.remote.latestChapterNumber, 1);
    assert.equal(validation.remote.nextChapterNumber, 2);
    assert.equal(validation.resolution.accountId, 'fanqie_main');

    const compare = await client.compareDatabaseChapter({
      targetId: 'target_1',
      chapterNumber: 1,
    });
    assert.equal(compare.itemId, 'item_1');
    assert.equal(compare.titleMatched, true);
    assert.equal(compare.contentMatched, true);
    assert.equal(compare.diff.databaseContentLength, 4);

    const changed = await client.edit.compareDatabaseChapter({
      targetId: 'target_1',
      chapterNumber: 1,
      contentText: '修改后的正文',
    });
    assert.equal(changed.contentMatched, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('protocol catalog exposes next publish route', () => {
  assert.equal(FANQIE_HTTP_ROUTES.includes('POST /accounts/login/discover'), true);
  assert.equal(FANQIE_HTTP_ROUTES.includes('POST /accounts/:id/reauth'), true);
  assert.equal(FANQIE_HTTP_ROUTES.includes('POST /publish/next-database-chapter'), true);
  assert.equal(FANQIE_HTTP_ROUTES.includes('POST /publish/tomato'), true);
  assert.equal(FANQIE_HTTP_ROUTES.includes('POST /publish/database-chapter/validate'), true);
  assert.equal(FANQIE_HTTP_ROUTES.includes('POST /edit/database-chapter/compare'), true);
});

test('account lock serializes browser operations for the same account', async () => {
  const lock = new AccountLock();
  const events: string[] = [];

  await Promise.all([
    lock.run('fanqie_main', async () => {
      events.push('a-start');
      await delay(20);
      events.push('a-end');
    }),
    lock.run('fanqie_main', async () => {
      events.push('b-start');
      events.push('b-end');
    }),
  ]);

  assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end']);
});

class RecordingDriver implements FanqiePlatformDriver {
  readonly configured = true;
  readonly name = 'recording';
  lastPublish: PublishChapterInput | null = null;
  lastEdit: EditRemoteChapterInput | null = null;
  remoteDetailReads = 0;

  async login(accountId: string): Promise<LoginResult> {
    return { accountId, status: 'started', headed: true };
  }

  async loginDiscovered(): Promise<LoginResult> {
    return { accountId: 'fanqie_discovered', status: 'completed', headed: true };
  }

  async checkSession(accountId: string): Promise<SessionCheckResult> {
    return { accountId, valid: true, status: 'valid', checkedAt: new Date().toISOString() };
  }

  async scanWorks(): Promise<RemoteWorkSnapshot[]> {
    return [];
  }

  async syncRemoteChapters(): Promise<RemoteChapterSnapshot[]> {
    return [{
      accountId: 'fanqie_main',
      platform: 'fanqie',
      bookId: 'book_1',
      itemId: 'item_1',
      chapterNumber: 1,
      title: '第1章 第一章',
      syncedAt: new Date(0).toISOString(),
    }];
  }

  async publishChapter(input: PublishChapterInput): Promise<PlatformConfirmationEvidence> {
    this.lastPublish = input;
    return {
      platform: 'fanqie',
      accountId: input.accountId,
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      evidence: { recorded: true },
    };
  }

  async getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail> {
    this.remoteDetailReads += 1;
    return {
      ...input,
      title: '第1章 第一章',
      contentText: '正文内容',
    };
  }

  async editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult> {
    this.lastEdit = input;
    return {
      success: true,
      accountId: input.accountId,
      bookId: input.bookId,
      itemId: input.itemId,
      after: {
        title: input.title,
        contentText: input.contentText,
      },
    };
  }
}

class LoginDiscoveryRecordingDriver extends RecordingDriver {
  discoveryLoginCount = 0;

  override async loginDiscovered(): Promise<LoginResult> {
    this.discoveryLoginCount += 1;
    return { accountId: 'fanqie_discovered', status: 'completed', headed: true };
  }
}

class ReauthRecordingDriver extends RecordingDriver {
  loginOptions: Array<Record<string, unknown>> = [];
  checkCount = 0;

  override async login(accountId: string, options: Record<string, unknown> = {}): Promise<LoginResult> {
    this.loginOptions.push(options);
    return { accountId, status: 'completed', headed: true };
  }

  override async checkSession(accountId: string): Promise<SessionCheckResult> {
    this.checkCount += 1;
    return {
      accountId,
      valid: this.checkCount > 1,
      status: this.checkCount > 1 ? 'valid' : 'expired',
      checkedAt: new Date(this.checkCount).toISOString(),
    };
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('default container wires the real script Playwright driver', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-container-test-'));
  const previousDataDir = process.env.FANQIE_SERVICE_DATA_DIR;
  const previousRoot = process.env.FANQIE_SERVICE_ROOT;
  try {
    process.env.FANQIE_SERVICE_DATA_DIR = dataDir;
    process.env.FANQIE_SERVICE_ROOT = dataDir;
    const container = createContainer();
    assert.equal(container.driver.configured, true);
    assert.equal(container.driver.name, 'script-playwright');
  } finally {
    if (previousDataDir === undefined) delete process.env.FANQIE_SERVICE_DATA_DIR;
    else process.env.FANQIE_SERVICE_DATA_DIR = previousDataDir;
    if (previousRoot === undefined) delete process.env.FANQIE_SERVICE_ROOT;
    else process.env.FANQIE_SERVICE_ROOT = previousRoot;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('script driver reaches runtime scripts through DataBase Gateway account resolution', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-script-driver-test-'));
  try {
    const driver = new ScriptFanqiePlatformDriver({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      rootDir: dataDir,
      version: 'test',
    });

    await assert.rejects(
      () => driver.checkSession('missing_account'),
      /DataBase Gateway|未从 DataBase 找到番茄账号配置/,
    );
    await assert.rejects(
      () => driver.publishChapter({
        accountId: 'missing_account',
        bookId: 'book_1',
        chapterNumber: 1,
        title: '第一章',
        content: '正文内容',
      }),
      /DataBase Gateway|未从 DataBase 找到番茄账号配置/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

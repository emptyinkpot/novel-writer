import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AccountService } from '../src/application/account/AccountService.js';
import { PublishService } from '../src/application/publish/PublishService.js';
import { PublishPlanningService } from '../src/application/publish/PublishPlanningService.js';
import { EditService } from '../src/application/edit/EditService.js';
import { RemoteScanService } from '../src/application/scan/RemoteScanService.js';
import { SessionService } from '../src/application/account/SessionService.js';
import type { PublicReaderService } from '../src/application/reader/PublicReaderService.js';
import { NotConfiguredFanqiePlatformDriver } from '../src/drivers/fanqie/FanqiePlatformDriver.js';
import { InMemoryPublishJobRepository } from '../src/runtime/queue/InMemoryPublishJobRepository.js';
import { FANQIE_TOOLS } from '../src/api/protocol/tool-catalog.js';
import { registerFanqieTools } from '../src/mcp/tool-registry/mcp-tools.js';
import { SessionGuardedFanqieDriver } from "../src/drivers/fanqie/SessionGuardedFanqieDriver.js";
import { AccountLock } from "../src/runtime/locks/AccountLock.js";
import type { LocalPublicationStore } from '../src/infrastructure/local/LocalPublicationStore.js';

test('mcp tool registry uses schema-first granular capability names', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fanqie-mcp-test-'));
  try {
    const driver = new NotConfiguredFanqiePlatformDriver();
    const database = createFakeDatabaseClient();
    const edit = new EditService(driver);
    const scan = new RemoteScanService(driver, database);
    const server = new McpServer({ name: 'fanqie-service-test', version: 'test' });
    registerFanqieTools(server, {
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        rootDir: dataDir,
        version: 'test',
      },
      driver,
      sessionGuard: new SessionGuardedFanqieDriver(driver),
      accountLock: new AccountLock(),
      accounts: new AccountService(database),
      sessions: new SessionService(driver),
      scan,
      publish: new PublishService(driver, new InMemoryPublishJobRepository()),
      publishPlanning: new PublishPlanningService(database, scan, edit),
      edit,
      reader: createFakeReaderService(),
      database,
      app: {} as never,
    });

    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'publish.chapter'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'account.reauth'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'account.login.discover'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'publish.job.get'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'publish.next.database.chapter'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'publish.database.chapter.validate'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'database.chapter.compare'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'database.publish.context'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'database.fanqie.works.sync'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'database.publication.target.register'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'reader.book.search'), true);
    assert.equal(FANQIE_TOOLS.some((tool) => tool.id === 'reader.book.export.text'), true);
    assert.equal(server.isConnected(), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createFakeDatabaseClient(): LocalPublicationStore {
  return {
    listPublicationTargets: async () => [],
    listFanqieWorks: async () => [],
    syncFanqieWorks: async () => ({ syncedAt: new Date(0).toISOString(), count: 0, works: [] }),
    syncFanqieRemoteChapters: async () => ({ syncedAt: new Date(0).toISOString(), chapterCount: 0 }),
    registerPublicationTarget: async () => ({
      id: 'fanqie_test',
      platform: 'fanqie',
      accountIdentity: 'fanqie_main',
      localWorkId: 'legacy_work_1',
      remoteWorkId: 'book_1',
      status: 'active',
    }),
    getPublishContext: async () => ({
      publicationTargets: [],
      fanqieWorks: [],
    }),
    listFanqieAccounts: async () => [],
  } as unknown as LocalPublicationStore;
}

function createFakeReaderService(): PublicReaderService {
  return {
    searchBooks: async () => [],
    getBookDetail: async () => ({
      bookId: 'reader_book_1',
      title: '公共作品',
      pageUrl: 'https://fanqienovel.com/page/reader_book_1',
      chapters: [],
    }),
    getChapterDetail: async () => ({
      itemId: 'reader_item_1',
      bookId: 'reader_book_1',
      title: '第一章',
      contentHtml: '<p>公共正文</p>',
      contentText: '公共正文',
    }),
    exportChapterText: async () => ({
      format: 'txt',
      filename: '公共作品-第一章-reader_item_1.txt',
      itemId: 'reader_item_1',
      bookId: 'reader_book_1',
      title: '第一章',
      content: '公共正文',
    }),
    exportBookText: async () => ({
      format: 'txt',
      filename: '公共作品-reader_book_1.txt',
      bookId: 'reader_book_1',
      title: '公共作品',
      chapterCount: 1,
      exportedChapterCount: 1,
      skippedChapters: [],
      chapters: [],
      content: '公共正文',
    }),
  } as unknown as PublicReaderService;
}

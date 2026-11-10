import { loadConfig } from './config.js';
import { AccountService } from './application/account/AccountService.js';
import { SessionService } from './application/account/SessionService.js';
import { RemoteScanService } from './application/scan/RemoteScanService.js';
import { PublishService } from './application/publish/PublishService.js';
import { PublishPlanningService } from './application/publish/PublishPlanningService.js';
import { EditService } from './application/edit/EditService.js';
import { PublicReaderService } from './application/reader/PublicReaderService.js';
import { ScriptFanqiePlatformDriver } from './drivers/fanqie/ScriptFanqiePlatformDriver.js';
import type { FanqiePlatformDriver } from './drivers/fanqie/FanqiePlatformDriver.js';
import { SessionGuardedFanqieDriver } from './drivers/fanqie/SessionGuardedFanqieDriver.js';
import { InMemoryPublishJobRepository } from './runtime/queue/InMemoryPublishJobRepository.js';
import { AccountLock } from './runtime/locks/AccountLock.js';
import { LocalPublicationStore } from './infrastructure/local/LocalPublicationStore.js';
import { FanqiePublicReaderClient } from './infrastructure/reader/FanqiePublicReaderClient.js';
import { createApp } from './api/http/createApp.js';
import type { Express } from 'express';

export interface FanqieServiceContainer {
  config: ReturnType<typeof loadConfig>;
  driver: FanqiePlatformDriver;
  sessionGuard: SessionGuardedFanqieDriver;
  accountLock: AccountLock;
  accounts: AccountService;
  sessions: SessionService;
  scan: RemoteScanService;
  publish: PublishService;
  publishPlanning: PublishPlanningService;
  edit: EditService;
  reader: PublicReaderService;
  database: LocalPublicationStore;
  app: Express;
}

export function createContainer(): FanqieServiceContainer {
  const config = loadConfig();
  const driver = new SessionGuardedFanqieDriver(new ScriptFanqiePlatformDriver(config), {
    cacheMs: Number(process.env.FANQIE_SESSION_CACHE_MINUTES ?? 10) * 60 * 1000,
    autoRelogin: process.env.FANQIE_AUTO_RELOGIN !== '0',
  });
  const database = new LocalPublicationStore();
  const publishJobRepository = new InMemoryPublishJobRepository();
  const accountLock = new AccountLock();
  const accounts = new AccountService(database);
  const sessions = new SessionService(driver);
  const scan = new RemoteScanService(driver, database, accountLock);
  const publish = new PublishService(driver, publishJobRepository, accountLock);
  const edit = new EditService(driver, accountLock);
  const publishPlanning = new PublishPlanningService(database, scan, edit);
  const reader = new PublicReaderService(new FanqiePublicReaderClient());
  const app = createApp({ config, driver, accounts, sessions, scan, publish, publishPlanning, edit, reader, database });

  return {
    config,
    driver,
    sessionGuard: driver,
    accountLock,
    accounts,
    sessions,
    scan,
    publish,
    publishPlanning,
    edit,
    reader,
    database,
    app,
  };
}

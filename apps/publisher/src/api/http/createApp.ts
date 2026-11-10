import express, { type Express } from 'express';
import type { FanqieServiceConfig } from '../../config.js';
import type { FanqiePlatformDriver } from '../../drivers/fanqie/FanqiePlatformDriver.js';
import type { AccountService } from '../../application/account/AccountService.js';
import type { SessionService } from '../../application/account/SessionService.js';
import type { RemoteScanService } from '../../application/scan/RemoteScanService.js';
import type { PublishService } from '../../application/publish/PublishService.js';
import type { PublishPlanningService } from '../../application/publish/PublishPlanningService.js';
import type { EditService } from '../../application/edit/EditService.js';
import type { PublicReaderService } from '../../application/reader/PublicReaderService.js';
import type { LocalPublicationStore } from '../../infrastructure/local/LocalPublicationStore.js';
import { createAccountsRouter } from './accounts.routes.js';
import { createSessionRouter } from './session.routes.js';
import { createScanRouter } from './scan.routes.js';
import { createPublishRouter } from './publish.routes.js';
import { createEditRouter } from './edit.routes.js';
import { createReaderRouter } from './reader.routes.js';
import { createDatabaseRouter } from './database.routes.js';
import { errorHandler, ok } from './respond.js';

export interface AppDeps {
  config: FanqieServiceConfig;
  driver: FanqiePlatformDriver;
  accounts: AccountService;
  sessions: SessionService;
  scan: RemoteScanService;
  publish: PublishService;
  publishPlanning: PublishPlanningService;
  edit: EditService;
  reader: PublicReaderService;
  database: LocalPublicationStore;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.get('/health', (_req, res) => {
    ok(res, {
      ok: true,
      service: 'fanqie-service',
      version: deps.config.version,
      time: new Date().toISOString(),
      driver: {
        configured: deps.driver.configured,
        name: deps.driver.name,
      },
    });
  });
  app.use(createAccountsRouter(deps.accounts));
  app.use(createSessionRouter(deps.sessions));
  app.use(createScanRouter(deps.scan));
  app.use(createPublishRouter(deps.publish, deps.publishPlanning, deps.database, deps.scan));
  app.use(createEditRouter(deps.edit, deps.publishPlanning, deps.database));
  app.use(createReaderRouter(deps.reader));
  app.use(createDatabaseRouter(deps.database, deps.scan));
  app.use(errorHandler);
  return app;
}

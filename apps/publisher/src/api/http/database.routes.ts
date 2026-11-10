import { Router, type Router as ExpressRouter } from 'express';
import type { LocalPublicationStore } from '../../infrastructure/local/LocalPublicationStore.js';
import { databaseDependencyUnavailable } from '../../infrastructure/local/LocalPublicationStore.js';
import type { RemoteScanService } from '../../application/scan/RemoteScanService.js';
import { ok } from './respond.js';

export function createDatabaseRouter(database: LocalPublicationStore, scan: RemoteScanService): ExpressRouter {
  const router = Router();

  router.get('/database/publication-targets', async (req, res, next) => {
    try {
      ok(res, await database.listPublicationTargets({
        platform: stringQuery(req.query.platform),
        accountIdentity: stringQuery(req.query.accountIdentity || req.query.account_identity),
        localWorkId: stringQuery(req.query.localWorkId || req.query.local_work_id),
        remoteWorkId: stringQuery(req.query.remoteWorkId || req.query.remote_work_id || req.query.bookId || req.query.book_id),
        limit: numberQuery(req.query.limit),
      }));
    } catch (error) {
      next(databaseDependencyUnavailable(error));
    }
  });

  router.get('/database/fanqie-works', async (req, res, next) => {
    try {
      ok(res, await database.listFanqieWorks({
        search: stringQuery(req.query.search),
        accountId: stringQuery(req.query.accountId || req.query.account_id),
        limit: numberQuery(req.query.limit),
      }));
    } catch (error) {
      next(databaseDependencyUnavailable(error));
    }
  });

  router.post('/database/sync-fanqie-works', async (req, res, next) => {
    try {
      const works = await scan.scanWorks(req.body);
      ok(res, await database.syncFanqieWorks(works));
    } catch (error) {
      next(databaseDependencyUnavailable(error));
    }
  });

  router.post('/database/register-publication-target', async (req, res, next) => {
    try {
      ok(res, await database.registerPublicationTarget(req.body));
    } catch (error) {
      next(databaseDependencyUnavailable(error));
    }
  });

  router.get('/database/publish-context', async (req, res, next) => {
    try {
      ok(res, await database.getPublishContext({
        accountId: stringQuery(req.query.accountId || req.query.account_id),
        bookId: stringQuery(req.query.bookId || req.query.book_id || req.query.remoteWorkId || req.query.remote_work_id),
        localWorkId: stringQuery(req.query.localWorkId || req.query.local_work_id),
        limit: numberQuery(req.query.limit),
      }));
    } catch (error) {
      next(databaseDependencyUnavailable(error));
    }
  });

  router.get('/database/publish-chapter', async (req, res, next) => {
    try {
      ok(res, await database.resolvePublishChapter({
        accountId: stringQuery(req.query.accountId || req.query.account_id),
        bookId: stringQuery(req.query.bookId || req.query.book_id || req.query.remoteWorkId || req.query.remote_work_id),
        localWorkId: stringQuery(req.query.localWorkId || req.query.local_work_id),
        chapterId: stringQuery(req.query.chapterId || req.query.chapter_id),
        chapterNumber: numberQuery(req.query.chapterNumber || req.query.chapter_number),
        idempotencyKey: stringQuery(req.query.idempotencyKey || req.query.idempotency_key),
        requestId: stringQuery(req.query.requestId || req.query.request_id),
      }));
    } catch (error) {
      next(databaseDependencyUnavailable(error));
    }
  });

  return router;
}

function stringQuery(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw == null ? '' : String(raw).trim();
  return text || undefined;
}

function numberQuery(value: unknown): number | undefined {
  const text = stringQuery(value);
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

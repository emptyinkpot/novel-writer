import { Router, type Router as ExpressRouter } from 'express';
import type { RemoteScanService } from '../../application/scan/RemoteScanService.js';
import { ok } from './respond.js';

export function createScanRouter(scan: RemoteScanService): ExpressRouter {
  const router = Router();
  router.post('/works/scan', async (req, res, next) => {
    try {
      ok(res, await scan.scanWorks(req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  router.post('/chapters/remote/sync', async (req, res, next) => {
    try {
      ok(res, await scan.syncRemoteChapters(req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

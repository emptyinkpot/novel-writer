import { Router, type Router as ExpressRouter } from 'express';
import type { SessionService } from '../../application/account/SessionService.js';
import { ok } from './respond.js';

export function createSessionRouter(sessions: SessionService): ExpressRouter {
  const router = Router();
  router.post('/accounts/login/discover', async (_req, res, next) => {
    try {
      ok(res, await sessions.loginDiscovered());
    } catch (error) {
      next(error);
    }
  });
  router.post('/accounts/:id/login', async (req, res, next) => {
    try {
      ok(res, await sessions.login(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  router.post('/accounts/:id/session/check', async (req, res, next) => {
    try {
      ok(res, await sessions.checkSession(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/state', (_req, res) => {
    ok(res, sessions.sessionState());
  });
  router.get('/accounts/:id/session/state', (req, res) => {
    ok(res, sessions.sessionState(req.params.id));
  });
  router.post('/accounts/:id/reauth', async (req, res, next) => {
    try {
      ok(res, await sessions.reauth(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

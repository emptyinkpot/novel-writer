import { Router, type Router as ExpressRouter } from 'express';
import type { AccountService } from '../../application/account/AccountService.js';
import { ok } from './respond.js';

export function createAccountsRouter(accounts: AccountService): ExpressRouter {
  const router = Router();
  router.get('/accounts', async (_req, res, next) => {
    try {
      ok(res, await accounts.listAccounts());
    } catch (error) {
      next(error);
    }
  });
  return router;
}

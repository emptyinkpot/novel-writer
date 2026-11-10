import { Router, type Router as ExpressRouter } from 'express';
import type { PublicReaderService } from '../../application/reader/PublicReaderService.js';
import { ok } from './respond.js';

export function createReaderRouter(reader: PublicReaderService): ExpressRouter {
  const router = Router();

  router.get('/reader/search', async (req, res, next) => {
    try {
      ok(res, await reader.searchBooks({
        query: stringQuery(req.query.q || req.query.query),
        limit: numberQuery(req.query.limit),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/reader/books/:bookId', async (req, res, next) => {
    try {
      ok(res, await reader.getBookDetail(req.params.bookId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/reader/chapters/:itemId', async (req, res, next) => {
    try {
      ok(res, await reader.getChapterDetail(req.params.itemId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/reader/export/chapter-text', async (req, res, next) => {
    try {
      const body = req.body;
      ok(res, await reader.exportChapterText({
        itemId: stringBody(body.itemId),
        includeMeta: booleanBody(body.includeMeta),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/reader/export/book-text', async (req, res, next) => {
    try {
      const body = req.body;
      ok(res, await reader.exportBookText({
        bookId: stringBody(body.bookId),
        itemIds: stringArray(body.itemIds),
        includeMeta: booleanBody(body.includeMeta),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/reader/comments/:bookId', async (req, res, next) => {
    try {
      ok(res, await reader.getBookComments(
        req.params.bookId,
        numberQuery(req.query.limit) || 30,
      ));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function stringQuery(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw == null ? '' : String(raw).trim();
}

function stringBody(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function numberQuery(value: unknown): number | undefined {
  const text = stringQuery(value);
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanBody(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

import { Router, type Router as ExpressRouter } from 'express';
import type { EditService } from '../../application/edit/EditService.js';
import type { PublishPlanningService } from '../../application/publish/PublishPlanningService.js';
import type { DataBasePublicationClient } from '../../infrastructure/database/DataBasePublicationClient.js';
import { databaseDependencyUnavailable } from '../../infrastructure/database/DataBasePublicationClient.js';
import { FanqieServiceError } from '../../sdk/errors.js';
import { ok } from './respond.js';

export function createEditRouter(edit: EditService, planning: PublishPlanningService, database: DataBasePublicationClient): ExpressRouter {
  const router = Router();

  router.get('/remote/chapters/:bookId/:itemId', async (req, res, next) => {
    try {
      ok(res, await edit.getRemoteChapter({
        accountId: stringQuery(req.query.accountId || req.query.account_id),
        bookId: req.params.bookId,
        itemId: req.params.itemId,
      } as { accountId: string; bookId: string; itemId: string }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/edit/chapter', async (req, res, next) => {
    try {
      ok(res, await edit.editRemoteChapter(req.body));
    } catch (error) {
      next(error);
    }
  });

  router.post('/edit/database-chapter', async (req, res, next) => {
    try {
      const body = req.body;
      const resolved = await database.resolvePublishChapter(body);
      const itemId = typeof body.itemId === 'string' && body.itemId.trim()
        ? body.itemId.trim()
        : await planning.resolveRemoteItemId(body, resolved);
      const result = await edit.editRemoteChapter({
        accountId: resolved.accountId,
        bookId: resolved.bookId,
        itemId,
        title: typeof body.title === 'string' && body.title.trim() ? body.title : resolved.chapter.title,
        contentText: typeof body.contentText === 'string' && body.contentText.trim() ? body.contentText : resolved.chapter.content,
        headless: body.headless,
        dryRun: body.dryRun,
      });
      await recordEditResult(database, resolved, result, body);
      ok(res, result);
    } catch (error) {
      next(error instanceof FanqieServiceError ? error : databaseDependencyUnavailable(error));
    }
  });

  router.post('/edit/database-chapter/compare', async (req, res, next) => {
    try {
      ok(res, await planning.compareDatabaseChapter(req.body));
    } catch (error) {
      next(error instanceof FanqieServiceError ? error : databaseDependencyUnavailable(error));
    }
  });

  return router;
}

function stringQuery(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw == null ? '' : String(raw).trim();
  return text || undefined;
}

async function recordEditResult(
  database: DataBasePublicationClient,
  resolved: Awaited<ReturnType<DataBasePublicationClient['resolvePublishChapter']>>,
  result: Awaited<ReturnType<EditService['editRemoteChapter']>>,
  body: Record<string, unknown>,
) {
  if (body.dryRun === true) return;
  if (result.success !== true) return;
  await database.recordPublicationResult({
    targetId: typeof body.targetId === 'string' && body.targetId.trim() ? body.targetId.trim() : undefined,
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

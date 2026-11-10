import { Router, type Router as ExpressRouter } from 'express';
import type { PublishService } from '../../application/publish/PublishService.js';
import type { PublishPlanningService } from '../../application/publish/PublishPlanningService.js';
import type { LocalPublicationStore } from '../../infrastructure/local/LocalPublicationStore.js';
import { databaseDependencyUnavailable } from '../../infrastructure/local/LocalPublicationStore.js';
import type { RemoteScanService } from '../../application/scan/RemoteScanService.js';
import { FanqieServiceError } from '../../sdk/errors.js';
import { ok } from './respond.js';

export function createPublishRouter(
  publish: PublishService,
  planning: PublishPlanningService,
  database: LocalPublicationStore,
  scan: RemoteScanService,
): ExpressRouter {
  const router = Router();
  router.post('/publish/chapter', async (req, res, next) => {
    try {
      ok(res, await publish.publishChapter(req.body));
    } catch (error) {
      next(error);
    }
  });
  router.post('/publish/tomato', async (req, res, next) => {
    try {
      ok(res, await publish.publishChapter(req.body));
    } catch (error) {
      next(error);
    }
  });
  router.post('/publish/database-chapter', async (req, res, next) => {
    let resolved;
    try {
      resolved = await database.resolvePublishChapter(req.body);
    } catch (error) {
      next(databaseDependencyUnavailable(error));
      return;
    }
    try {
      const result = await publish.publishChapter(resolved.publishInput);
      await recordPublishResult(database, resolved, result, req.body);
      ok(res, result);
    } catch (error) {
      next(error);
    }
  });
  router.post('/publish/database-chapter/validate', async (req, res, next) => {
    try {
      ok(res, await planning.validateDatabaseChapter(req.body));
    } catch (error) {
      next(error instanceof FanqieServiceError ? error : databaseDependencyUnavailable(error));
    }
  });
  router.post('/publish/next-database-chapter', async (req, res, next) => {
    try {
      const body = req.body;
      const context = await database.getPublishContext(body);
      const accountId = required(context.accountId || body.accountId, 'accountId');
      const bookId = required(context.bookId || body.bookId, 'bookId');
      const localWorkId = required(context.localWorkId || body.localWorkId, 'localWorkId');
      const chapters = await scan.syncRemoteChapters({
        accountId,
        bookId,
        refresh: true,
        persist: false,
      });
      const latest = chapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapterNumber || 0)), 0);
      const resolved = await database.resolvePublishChapter({
        ...body,
        accountId,
        bookId,
        localWorkId,
        chapterNumber: latest + 1,
      });
      const result = await publish.publishChapter(resolved.publishInput);
      await recordPublishResult(database, resolved, result, body);
      ok(res, result);
    } catch (error) {
      next(error instanceof FanqieServiceError ? error : databaseDependencyUnavailable(error));
    }
  });
  router.get('/publish/jobs/:jobId', async (req, res, next) => {
    try {
      const job = await publish.getPublishJob(req.params.jobId);
      if (!job) throw new FanqieServiceError('publish_job_not_found', 'publish job not found', 404);
      ok(res, job);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function required(value: unknown, field: string): string {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new FanqieServiceError('database_publish_context_incomplete', `${field} is required`, 422);
  return text;
}

async function recordPublishResult(
  database: LocalPublicationStore,
  resolved: Awaited<ReturnType<LocalPublicationStore['resolvePublishChapter']>>,
  result: Awaited<ReturnType<PublishService['publishChapter']>>,
  body: Record<string, unknown>,
) {
  if (resolved.publishInput.dryRun === true) return;
  if (result.status !== 'succeeded') return;
  if (!result.confirmation) return;
  const evidence = result.confirmation.evidence;
  const evidenceRecord = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence as Record<string, unknown>
    : {};
  const matched = evidenceRecord.matchedChapter;
  const matchedRecord = matched && typeof matched === 'object' && !Array.isArray(matched)
    ? matched as Record<string, unknown>
    : {};
  const itemId = matchedRecord.itemId == null ? undefined : String(matchedRecord.itemId);
  await database.recordPublicationResult({
    targetId: typeof body.targetId === 'string' && body.targetId.trim() ? body.targetId.trim() : undefined,
    accountId: resolved.accountId,
    bookId: resolved.bookId,
    localWorkId: resolved.localWorkId,
    chapterId: resolved.chapter.id,
    chapterNumber: resolved.chapter.chapterNumber,
    contentPartId: `legacy_chapter_${resolved.chapter.id}`,
    action: 'publish_chapter',
    remotePartId: itemId,
    observedStatus: result.confirmation.confirmed ? 'published' : 'submitted',
    publishedAt: result.confirmation.confirmedAt,
    result: {
      jobId: result.jobId,
      confirmation: result.confirmation,
    },
  });
}

// 异步文章任务运行器源码：创建、执行、超时控制和持久化 article job 进度。
// 它负责 job 生命周期，不负责文章内容策略。
import type { ArticleProgressEvent, ArticleRuntime } from '../article/index.ts';
import type { ArticleJob, ArticleJobStore, ArticleJobStatus } from './article-job-store.ts';

type ArticleJobRunnerDeps = {
  articleRuntime: ArticleRuntime;
  articleJobStore: ArticleJobStore;
  jobTimeoutMs?: unknown;
  progressDrainTimeoutMs?: unknown;
};

export type PublicArticleJob = Pick<ArticleJob,
  'id' | 'status' | 'stage' | 'lastMessage' | 'createdAt' | 'startedAt' | 'finishedAt' | 'updatedAt' | 'events' | 'error'
> & {
  resultUrl: string;
};

type DiagnosticError = Error & {
  diagnostics?: unknown;
};

export function createArticleJobRunner({
  articleRuntime,
  articleJobStore,
  jobTimeoutMs,
  progressDrainTimeoutMs,
}: ArticleJobRunnerDeps) {
  if (!articleRuntime) throw new Error('articleRuntime is required');
  if (!articleJobStore) throw new Error('articleJobStore is required');
  const articleJobTimeoutMs = readPositiveInteger(jobTimeoutMs, 600 * 1000);
  const articleProgressDrainTimeoutMs = readPositiveInteger(progressDrainTimeoutMs, 15 * 1000);

  async function createArticleJob(input: unknown): Promise<ArticleJob> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const job: ArticleJob = {
      id,
      status: 'queued' satisfies ArticleJobStatus,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date().toISOString(),
      stage: 'queued',
      lastMessage: 'Article generation job queued',
      events: [],
      error: null,
      result: null,
      persistQueue: Promise.resolve(),
    };
    await articleJobStore.create(job, input);
    setImmediate(async () => {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      await updateArticleJobProgress(job, 'running', 'Article generation job started');
      const controller = new AbortController();
      try {
        let touchArticleJobProgress = () => {};
        const articleGeneration = articleRuntime.generateArticle(input, {
          signal: controller.signal,
          onProgress: (event: ArticleProgressEvent) => {
            touchArticleJobProgress();
            job.persistQueue = job.persistQueue
              .then(() => updateArticleJobProgress(job, event.stage, event.message, event.at))
              .catch((error) => console.error(`[ContentBase] article job progress persist failed: ${error instanceof Error ? error.message : String(error)}`));
          },
        });
        const progressGuard = withProgressTimeout(
          articleGeneration,
          articleJobTimeoutMs,
          `Article generation job made no progress for ${articleJobTimeoutMs}ms`,
          () => controller.abort(new Error(`Article generation job made no progress for ${articleJobTimeoutMs}ms`)),
        );
        touchArticleJobProgress = progressGuard.touch;
        job.result = await progressGuard.promise;
        await drainArticleProgress(job);
        // The article is already generated at this point (job.result is set). A transient
        // failure persisting the "finished" progress event must not demote a completed
        // article to failed and discard job.result — log and move on.
        job.status = 'finished';
        try {
          await updateArticleJobProgress(job, 'finished', 'Article generation job finished');
        } catch (progressError) {
          console.error(`[ContentBase] article job final progress persist failed: ${progressError instanceof Error ? progressError.message : String(progressError)}`);
        }
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        const diagnosticError = error as DiagnosticError;
        if (diagnosticError?.diagnostics) {
          job.result = {
            status: 'failed',
            error: job.error,
            diagnostics: diagnosticError.diagnostics,
          };
        }
        await updateArticleJobProgress(job, 'failed', job.error);
      } finally {
        await drainArticleProgress(job);
        job.finishedAt = new Date().toISOString();
        job.updatedAt = job.finishedAt;
        await articleJobStore.update(job);
      }
    });
    return job;
  }

  async function drainArticleProgress(job: ArticleJob) {
    try {
      await withTimeout(
        job.persistQueue,
        articleProgressDrainTimeoutMs,
        `Article job progress drain timed out after ${articleProgressDrainTimeoutMs}ms`,
      );
    } catch (error) {
      console.error(`[ContentBase] article job progress drain failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function reconcileStaleArticleJob(job: ArticleJob | null): Promise<ArticleJob | null> {
    if (!job || job.status === 'finished' || job.status === 'failed') return job;
    const lastProgressAt = readLastProgressTime(job);
    if (!Number.isFinite(lastProgressAt)) return job;
    const staleMs = Date.now() - lastProgressAt;
    if (staleMs < articleJobTimeoutMs) return job;

    const previousStage = String(job.stage || job.status || 'running').trim() || 'running';
    const failedAt = new Date().toISOString();
    const message = `Article generation job lost progress at ${previousStage} for ${staleMs}ms; marking failed after runner timeout ${articleJobTimeoutMs}ms`;
    job.status = 'failed';
    job.stage = `${previousStage}_timeout`;
    job.lastMessage = message;
    job.error = message;
    job.finishedAt = failedAt;
    job.updatedAt = failedAt;
    job.events = Array.isArray(job.events) ? job.events : [];
    job.events.push({ stage: job.stage, message, at: failedAt });
    if (job.events.length > 50) {
      job.events.splice(0, job.events.length - 50);
    }
    await articleJobStore.update(job);
    return job;
  }

  async function updateArticleJobProgress(job: ArticleJob, stage: string, message: string, at = new Date().toISOString()) {
    job.stage = stage;
    job.lastMessage = message;
    job.updatedAt = at;
    job.events.push({ stage, message, at });
    if (job.events.length > 50) {
      job.events.splice(0, job.events.length - 50);
    }
    await articleJobStore.update(job);
  }

  return {
    createArticleJob,
    reconcileStaleArticleJob,
    publicArticleJob,
  };
}

function readLastProgressTime(job: ArticleJob): number {
  const eventTimes = Array.isArray(job.events)
    ? job.events
      .map((event) => Date.parse(String(event?.at || '')))
      .filter(Number.isFinite)
    : [];
  if (eventTimes.length) return Math.max(...eventTimes);
  return Date.parse(job.updatedAt || job.startedAt || job.createdAt || '');
}

export function publicArticleJob(job: ArticleJob): PublicArticleJob {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    lastMessage: job.lastMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    events: job.events,
    error: job.error,
    resultUrl: `/api/content/runtime/generate/article/jobs/${job.id}/result`,
  };
}

function readPositiveInteger(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : defaultValue;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        if (typeof onTimeout === 'function') onTimeout();
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function withProgressTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (reject: (reason?: unknown) => void) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typeof onTimeout === 'function') onTimeout();
      reject(new Error(message));
    }, timeoutMs);
  };
  let rejectProgressTimeout: ((reason?: unknown) => void) | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    rejectProgressTimeout = reject;
    arm(reject);
  });
  return {
    promise: Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer)),
    touch: () => {
      if (rejectProgressTimeout) arm(rejectProgressTimeout);
    },
  };
}

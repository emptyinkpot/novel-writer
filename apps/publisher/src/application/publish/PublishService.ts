import { createHash } from 'node:crypto';
import type { FanqiePlatformDriver } from '../../drivers/fanqie/FanqiePlatformDriver.js';
import type { AccountLock } from '../../runtime/locks/AccountLock.js';
import type { PublishChapterInput, PublishJobStatus, PublishResult } from '../../sdk/types.js';
import { FanqieServiceError } from '../../sdk/errors.js';

export interface PublishJobStateStore {
  get(jobId: string): Promise<PublishJobStatus | null>;
  save(job: PublishJobStatus): Promise<PublishJobStatus>;
}

export class PublishService {
  constructor(
    private readonly driver: FanqiePlatformDriver,
    private readonly jobs: PublishJobStateStore,
    private readonly accountLock?: AccountLock,
  ) {}

  async publishChapter(input: PublishChapterInput): Promise<PublishResult> {
    validatePublishInput(input);
    const now = new Date().toISOString();
    const jobId = input.idempotencyKey || createPublishJobId(input);
    const existing = await this.jobs.get(jobId);
    if (existing) {
      return {
        jobId,
        accepted: true,
        completed: ['succeeded', 'failed', 'cancelled'].includes(existing.status),
        status: existing.status,
        confirmation: existing.result,
        error: existing.error,
      };
    }

    let job: PublishJobStatus = {
      jobId,
      status: 'queued',
      accountId: input.accountId,
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      dryRun: input.dryRun === true,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.save(job);

    if (input.waitForCompletion === false) {
      void this.runPublishJob(job, input);
      return { jobId, accepted: true, completed: false, status: 'queued' };
    }

    job = await this.runPublishJob(job, input);
    return {
      jobId,
      accepted: true,
      completed: true,
      status: job.status,
      confirmation: job.result,
      error: job.error,
    };
  }

  getPublishJob(jobId: string) {
    return this.jobs.get(jobId);
  }

  private async runPublishJob(job: PublishJobStatus, input: PublishChapterInput): Promise<PublishJobStatus> {
    const startedAt = new Date().toISOString();
    job = { ...job, status: 'running', startedAt, updatedAt: startedAt };
    await this.jobs.save(job);

    try {
      const result = input.dryRun
        ? {
          platform: 'fanqie' as const,
          accountId: input.accountId,
          bookId: input.bookId,
          chapterNumber: input.chapterNumber,
          confirmed: false,
          confirmedAt: new Date().toISOString(),
          evidence: { dryRun: true },
        }
        : await this.runWithAccountLock(input.accountId, () => this.driver.publishChapter(input));
      const finishedAt = new Date().toISOString();
      job = {
        ...job,
        status: input.dryRun || result.confirmed ? 'succeeded' : 'failed',
        result,
        finishedAt,
        updatedAt: finishedAt,
        error: result.confirmed || input.dryRun ? undefined : 'platform confirmation failed',
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      job = {
        ...job,
        status: 'failed',
        finishedAt,
        updatedAt: finishedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await this.jobs.save(job);
    return job;
  }

  private runWithAccountLock<T>(accountId: string, task: () => Promise<T>) {
    if (!this.accountLock) return task();
    return this.accountLock.run(accountId, task);
  }
}

function validatePublishInput(input: PublishChapterInput) {
  if (!input.accountId?.trim()) throw new FanqieServiceError('invalid_publish_input', 'accountId is required', 400);
  if (!input.bookId?.trim()) throw new FanqieServiceError('invalid_publish_input', 'bookId is required', 400);
  if (!Number.isFinite(Number(input.chapterNumber)) || Number(input.chapterNumber) <= 0) {
    throw new FanqieServiceError('invalid_publish_input', 'chapterNumber must be positive', 400);
  }
  if (!input.title?.trim()) throw new FanqieServiceError('invalid_publish_input', 'title is required', 400);
  if (!input.content?.trim()) throw new FanqieServiceError('invalid_publish_input', 'content is required', 400);
}

function createPublishJobId(input: PublishChapterInput): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      accountId: input.accountId,
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      source: input.source,
    }))
    .digest('hex')
    .slice(0, 24);
  return `publish_${digest}`;
}

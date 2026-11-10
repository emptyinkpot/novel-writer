import type { PublishJobStatus } from '../../sdk/types.js';

/**
 * 发布任务只属于 fanqie-service 当前进程的执行态。
 *
 * DataBase 保存作品、章节、账号、cookie、作品绑定等业务真相；
 * 这里不写 JSON 文件，避免把发布队列变成第二套持久数据库。
 */
export class InMemoryPublishJobRepository {
  private readonly jobs = new Map<string, PublishJobStatus>();

  async get(jobId: string): Promise<PublishJobStatus | null> {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : job;
  }

  async save(job: PublishJobStatus): Promise<PublishJobStatus> {
    this.jobs.set(job.jobId, job);
    return job;
  }
}

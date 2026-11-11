// 文章任务存储源码：在本地 data/writer-engine.sqlite 持久化 article job、进度和结果。
// 这里只处理存储协议，不参与生成决策。
import { openWriterDb, type SqliteDb } from '../storage/local-db.ts';


export type ArticleJobStatus = 'queued' | 'running' | 'finished' | 'failed';

export type ArticleJobEvent = {
  stage: string;
  message: string;
  at: string;
};

export type ArticleJob = {
  id: string;
  status: ArticleJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  stage: string;
  lastMessage: string;
  events: ArticleJobEvent[];
  error: string | null;
  result: unknown;
  persistQueue?: Promise<void>;
};

export type ArticleJobStore = {
  create: (job: ArticleJob, requestBody: unknown) => Promise<unknown>;
  get: (id: string) => Promise<ArticleJob | null>;
  result: (id: string) => Promise<unknown>;
  update: (job: ArticleJob) => Promise<unknown>;
};

export function createArticleJobStore(db: SqliteDb = openWriterDb()) {
  const toJob = (row: Record<string, any> | undefined): ArticleJob | null => row ? ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    stage: row.stage || '',
    lastMessage: row.last_message || '',
    events: parseJson(row.events, []),
    error: row.error,
    result: parseJson(row.result, null),
  }) : null;

  return {
    create: async (job: ArticleJob, requestBody: unknown) => {
      db.prepare(`INSERT OR REPLACE INTO article_jobs (id, status, stage, last_message, request, events, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(job.id, job.status, job.stage, job.lastMessage, JSON.stringify(requestBody ?? null),
        JSON.stringify(job.events || []), job.createdAt, job.updatedAt);
      return toJob(db.prepare('SELECT * FROM article_jobs WHERE id = ?').get(job.id) as Record<string, any>);
    },
    get: async (id: string) => toJob(db.prepare('SELECT * FROM article_jobs WHERE id = ?').get(id) as Record<string, any>),
    result: async (id: string) => {
      const row = db.prepare('SELECT result FROM article_jobs WHERE id = ?').get(id) as Record<string, any> | undefined;
      return row ? { result: parseJson(row.result, null) } : null;
    },
    update: async (job: ArticleJob) => {
      db.prepare(`UPDATE article_jobs SET status = ?, stage = ?, last_message = ?, events = ?, error = ?, result = ?,
        started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`).run(job.status, job.stage, job.lastMessage,
        JSON.stringify(job.events || []), job.error, job.result === undefined ? null : JSON.stringify(job.result),
        job.startedAt, job.finishedAt, job.updatedAt, job.id);
      return toJob(db.prepare('SELECT * FROM article_jobs WHERE id = ?').get(job.id) as Record<string, any>);
    },
  } satisfies ArticleJobStore;
}

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

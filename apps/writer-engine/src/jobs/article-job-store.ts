// 文章任务存储源码：通过 DataBase Gateway 持久化 article job、进度和结果。
// 这里只处理存储协议，不参与生成决策。
import { databaseGatewayHeaders, getArticleJobGatewayService } from '../config/env.ts';

type ArticleJobStoreRequestOptions = {
  method?: string;
  body?: unknown;
};

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

type GatewayItemResponse<T> = {
  ok?: boolean;
  item?: T;
  message?: string;
  error?: string;
};

export type ArticleJobStore = {
  create: (job: ArticleJob, requestBody: unknown) => Promise<unknown>;
  get: (id: string) => Promise<ArticleJob | null>;
  result: (id: string) => Promise<unknown>;
  update: (job: ArticleJob) => Promise<unknown>;
};

export function createArticleJobStore() {
  const service = getArticleJobGatewayService();
  const gatewayUrl = service.baseUrl;
  const requestTimeoutMs = readPositiveInteger(process.env.CONTENTBASE_JOB_STORE_TIMEOUT_MS, 60000);
  if (!gatewayUrl) {
    throw new Error('CONTENTBASE_JOB_GATEWAY_URL or DATABASE_GATEWAY_URL is required for persistent article jobs');
  }
  if (!service.explicitJobGateway && isDockerHostGatewayUrl(gatewayUrl)) {
    throw new Error('CONTENTBASE_JOB_GATEWAY_URL is required when DATABASE_GATEWAY_URL points at a Docker host gateway address');
  }

  const headers = { 'content-type': 'application/json', ...databaseGatewayHeaders(service) };

  async function request<T = unknown>(path: string, options: ArticleJobStoreRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`DataBase Gateway article job request timed out after ${requestTimeoutMs}ms`)), requestTimeoutMs);
    let response;
    try {
      response = await fetch(`${gatewayUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`DataBase Gateway article job request timed out after ${requestTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    let body: GatewayItemResponse<T> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`DataBase Gateway returned non-JSON HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    if (!response.ok || body.ok === false) {
      throw new Error(`DataBase Gateway article job request failed: HTTP ${response.status} ${body.message || body.error || ''}`.trim());
    }
    return body.item;
  }

  return {
    create: (job: ArticleJob, requestBody: unknown) => request('/contentbase/article-jobs', {
      method: 'POST',
      body: {
        id: job.id,
        status: job.status,
        stage: job.stage,
        lastMessage: job.lastMessage,
        request: requestBody,
        events: job.events,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    }),
    get: (id: string) => request(`/contentbase/article-jobs/${encodeURIComponent(id)}`),
    result: async (id: string) => {
      const item = await request(`/contentbase/article-jobs/${encodeURIComponent(id)}/result`);
      return item;
    },
    update: (job: ArticleJob) => request(`/contentbase/article-jobs/${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      body: {
        status: job.status,
        stage: job.stage,
        lastMessage: job.lastMessage,
        events: job.events,
        error: job.error,
        result: job.result,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        finishedAt: job.finishedAt,
      },
    }),
  } satisfies ArticleJobStore;
}

function readPositiveInteger(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : defaultValue;
}

function isDockerHostGatewayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  } catch {
    return false;
  }
}

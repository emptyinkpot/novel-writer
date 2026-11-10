import { getContentBaseApiKey, getContentBaseBaseUrl } from './env.ts';

export type ArticleToolInput = {
  input?: string;
  topic?: string;
  targetWordCount?: number;
  wait?: boolean;
  timeoutSec?: number;
  pollIntervalSec?: number;
};

export async function health(): Promise<any> {
  return requestJson('GET', '/healthz');
}

export async function collectMaterials(args: Record<string, any>): Promise<any> {
  return requestJson('POST', '/api/content/runtime/generate/article/materials', buildArticleRequest(args));
}

export async function createArticleJob(args: Record<string, any>): Promise<any> {
  return requestJson('POST', '/api/content/runtime/generate/article/jobs', buildArticleRequest(args));
}

export async function getJob(jobId: string): Promise<any> {
  return requestJson('GET', `/api/content/runtime/generate/article/jobs/${encodeURIComponent(requiredString(jobId, 'jobId'))}`);
}

export async function getArticleResult(jobId: string): Promise<any> {
  return requestJson('GET', `/api/content/runtime/generate/article/jobs/${encodeURIComponent(requiredString(jobId, 'jobId'))}/result`);
}

export async function polishArticle(args: Record<string, any>): Promise<any> {
  return requestJson('POST', '/api/content/runtime/polish/article', {
    body: requiredString(args.body, 'body'),
    title: String(args.title || ''),
    instruction: String(args.instruction || ''),
  });
}

export async function finalEditArticle(args: Record<string, any>): Promise<any> {
  return requestJson('POST', '/api/content/runtime/final-edit/article', {
    body: requiredString(args.body, 'body'),
    title: String(args.title || ''),
    topic: String(args.topic || ''),
    query: String(args.query || ''),
    styleAnchor: String(args.styleAnchor || ''),
    openingImage: String(args.openingImage || ''),
    chapterBoundaries: String(args.chapterBoundaries || ''),
    targetWordCount: Number(args.targetWordCount || 0) || undefined,
    settings: typeof args.settings === 'object' && args.settings ? args.settings : undefined,
  });
}

export async function waitForJob(jobId: string, timeoutSec: number, pollIntervalSec: number): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutSec) * 1000;
  while (Date.now() < deadline) {
    const status = await getJob(jobId);
    const job = status?.data || {};
    if (job.status === 'finished') return;
    if (job.status === 'failed') throw new Error(`ContentBase job failed: ${job.error || 'unknown error'}`);
    await sleep(Math.max(1, pollIntervalSec) * 1000);
  }
  throw new Error(`ContentBase job ${jobId} did not finish within ${timeoutSec}s`);
}

export function buildArticleRequest(args: Record<string, any>): Record<string, any> {
  const input = requiredString(args.input, 'input');
  const topic = String(args.topic || '').trim();
  const targetWordCount = Number(args.targetWordCount || 8000);
  const includeWeb = args.includeWeb === undefined ? false : Boolean(args.includeWeb);
  const includeRagflow = args.includeRagflow === undefined ? true : Boolean(args.includeRagflow);
  const persistWeb = args.persistWeb === undefined ? false : Boolean(args.persistWeb);
  const rounds = Number(args.rounds || 2);
  const evidenceTimeoutMs = Number(args.evidenceTimeoutMs || 120000);
  return {
    input,
    ...(topic ? { topic, target: topic } : {}),
    structure: { targetWordCount },
    evidenceQuery: {
      query: topic || input,
      includeWeb,
      includeRagflow,
      persistWeb,
      rounds,
      evidenceTimeoutMs,
      requireCorpus: true,
    },
    settings: {},
  };
}

export function requiredString(value: unknown, name: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

async function requestJson(method: string, path: string, body?: unknown): Promise<any> {
  const baseUrl = getContentBaseBaseUrl();
  if (!baseUrl) throw new Error('CONTENTBASE_TEST_BASE_URL is required for ContentBase MCP');
  const headers: Record<string, string> = { accept: 'application/json' };
  const apiKey = getContentBaseApiKey();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok || parsed?.success === false) {
    throw new Error(`HTTP ${method} ${path} failed: ${response.status} ${response.statusText} ${String(parsed?.error || parsed?.message || text).slice(0, 500)}`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ContentBase 唯一服务入口：直接执行时启动 HTTP 进程；被 import 时只暴露 server 工厂。
import http from 'node:http';
import path from 'node:path';
import { createArticleRuntime } from './article/index.ts';
import { loadRuntimeEnv } from './config/env.ts';
import { openWriterDb } from './storage/local-db.ts';
import { createArticleJobStore } from './jobs/article-job-store.ts';
import { createArticleJobRunner } from './jobs/article-job-runner.ts';
import { renderArticleJobConsole } from './ui/article-job-console.ts';
import { corpusDiagnostics } from './services/corpus-diagnostics.ts';
import { readJson, writeHtml, writeJson, writeMarkdown } from './utils/http-utils.ts';

export function createContentBaseServer({ workspaceRoot }: { workspaceRoot?: string } = {}) {
  // 启动装配阶段 A：加载文章领域业务入口。
  // article/index.ts 只暴露文章业务入口；context / writer / postprocess 由 article 内部组装。
  // 这一步发生在 server.listen() 之前，不会生成文章。

  // 启动装配阶段 B：创建 articleRuntime 生成器对象。
  // 这里调用 runtime/article-runtime.ts 的 createArticleRuntime()。
  // 返回的 articleRuntime 像一个对象集装箱，里面有 generateArticle 和 polishArticle 两个方法。
  // 这一步也发生在 server.listen() 之前，只是组装生成器，不会真正调用 Writer。
  const articleRuntime = createArticleRuntime();
  // 启动装配阶段 C：创建异步 job 存储和 job runner。
  // job runner 后面会复用同一个 articleRuntime.generateArticle()，只是多了一层排队、进度和结果保存。
  const articleJobStore = createArticleJobStore();
  const articleJobRunner = createArticleJobRunner({
    articleRuntime,
    articleJobStore,
    // 保持外层无进展超时长于 context + 主 Writer 预算，让 owner 层的超时先暴露。
    jobTimeoutMs: process.env.CONTENTBASE_ARTICLE_JOB_TIMEOUT_MS,
    progressDrainTimeoutMs: process.env.CONTENTBASE_ARTICLE_PROGRESS_DRAIN_TIMEOUT_MS || 15 * 1000,
  });

  // 启动装配阶段 D：创建 HTTP 请求回调。
  // 注意：return http.createServer(...) 只是把“收到请求后怎么处理”的函数注册好。
  // 这段回调里的代码不会在启动时顺序跑完；只有外部请求打到对应 URL 时才执行对应分支。
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (req.method === 'OPTIONS') {
        writeJson(res, 204, null);
        return;
      }

      if (url.pathname === '/api/health' || url.pathname === '/healthz' || url.pathname === '/api/novel/health') {
        writeJson(res, 200, {
          success: true,
          data: {
            service: 'contentbase',
            runtime: 'corpus-retrieval-composition-writer',
            generatedAt: new Date().toISOString(),
            uptimeSec: Math.round(process.uptime()),
          },
        });
        return;
      }

      if (url.pathname === '/api/content/runtime/generate/article' && req.method === 'POST') {
        // 请求阶段：同步文章生成接口。
        // 外部 POST 这个 URL 时，才会真正调用 articleRuntime.generateArticle(input)，开始一次完整生成。
        const input = await readJson(req);
        const data = await articleRuntime.generateArticle(input);
        writeJson(res, 200, { success: true, data });
        return;
      }

      if (url.pathname === '/api/content/runtime/generate/article/materials' && req.method === 'POST') {
        // 请求阶段：只运行资料阶段；不进入 outline、author、enrichment、review、revision。
        const input = await readJson(req);
        const data = await articleRuntime.collectArticleMaterials(input);
        writeJson(res, 200, { success: true, data });
        return;
      }

      if (url.pathname === '/api/content/runtime/generate/article/jobs' && req.method === 'POST') {
        // 请求阶段：异步文章生成接口。
        // 这里不直接等文章生成完成，而是创建 job；后台 job runner 再调用 articleRuntime.generateArticle(input)。
        const input = await readJson(req);
        const job = await articleJobRunner.createArticleJob(input);
        writeJson(res, 202, { success: true, data: articleJobRunner.publicArticleJob(job) });
        return;
      }

      const articleDownloadMatch = url.pathname.match(/^\/api\/content\/runtime\/generate\/article\/jobs\/([^/]+)\/download(?:\/([^/]+))?$/);
      if (articleDownloadMatch && req.method === 'GET') {
        const job = await articleJobRunner.reconcileStaleArticleJob(await articleJobStore.get(articleDownloadMatch[1]));
        if (!job) {
          writeJson(res, 404, { success: false, error: 'Article generation job not found' });
          return;
        }
        if (job.status !== 'finished') {
          writeJson(res, 202, { success: true, data: articleJobRunner.publicArticleJob(job) });
          return;
        }
        const storedResult = unwrapStoredArticleResult(await articleJobStore.result(job.id));
        const resultObject = readObject(storedResult);
        const draft = readObject(resultObject.draft);
        const body = String(draft.body || '').trim();
        if (!body) {
          writeJson(res, 404, { success: false, error: 'Article generation result has no draft body' });
          return;
        }
        const requestedName = articleDownloadMatch[2] ? decodeURIComponent(articleDownloadMatch[2]) : '';
        writeMarkdown(res, 200, body, requestedName || `${job.id}.md`);
        return;
      }

      const articleJobMatch = url.pathname.match(/^\/api\/content\/runtime\/generate\/article\/jobs\/([^/]+)(?:\/result)?$/);
      if (articleJobMatch && req.method === 'GET') {
        const job = await articleJobRunner.reconcileStaleArticleJob(await articleJobStore.get(articleJobMatch[1]));
        if (!job) {
          writeJson(res, 404, { success: false, error: 'Article generation job not found' });
          return;
        }
        if (url.pathname.endsWith('/result')) {
          if (job.status !== 'finished' && !job.result) {
            writeJson(res, 202, { success: true, data: articleJobRunner.publicArticleJob(job) });
            return;
          }
          const storedResult = unwrapStoredArticleResult(await articleJobStore.result(job.id));
          writeJson(res, 200, { success: true, data: storedResult ?? job.result });
          return;
        }
        writeJson(res, 200, { success: true, data: articleJobRunner.publicArticleJob(job) });
        return;
      }

      if (url.pathname === '/api/content/runtime/polish/article' && req.method === 'POST') {
        // 请求阶段：润色接口。
        // 只调用 articleRuntime.polishArticle(input)，不走完整 EvidencePack 检索生成链。
        const input = await readJson(req);
        const data = await articleRuntime.polishArticle(input);
        writeJson(res, 200, { success: true, data });
        return;
      }

      if (url.pathname === '/api/content/runtime/final-edit/article' && req.method === 'POST') {
        // 请求阶段：终稿编辑接口。
        // 对已有正文进行全文评估、补充检索和局部终稿编辑，不重走完整生成链。
        const input = await readJson(req);
        const data = await articleRuntime.finalEditArticle(input);
        writeJson(res, 200, { success: true, data });
        return;
      }

      if (url.pathname === '/api/content/runtime/memory/feedback' && req.method === 'POST') {
        const input = await readJson(req);
        const data = await recordFeedbackMemory(input);
        writeJson(res, 200, { success: true, data });
        return;
      }

      if (url.pathname === '/api/corpus/diagnostics' && req.method === 'GET') {
        // 请求阶段：语料诊断接口。
        // 只有访问这个 URL 时才调用 corpus-diagnostics.ts；它不生成文章，只检查语料和外部服务状态。
        const data = await corpusDiagnostics();
        writeJson(res, 200, { success: true, data });
        return;
      }

      if ((url.pathname === '/' || url.pathname === '/article-jobs') && req.method === 'GET') {
        writeHtml(res, 200, renderArticleJobConsole());
        return;
      }

      writeJson(res, 404, { success: false, error: 'Not Found', path: url.pathname });
    } catch (error) {
      writeJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function recordFeedbackMemory(input: unknown) {
  const source = readObject(input);
  const userFeedback = String(source.userFeedback || source.feedback || '').trim();
  if (!userFeedback) {
    throw new Error('userFeedback is required');
  }

  const info = openWriterDb().prepare(`INSERT INTO writing_feedback (topic, title, verdict, user_feedback, draft_excerpt, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    String(source.topic || '').trim(),
    String(source.title || '').trim(),
    String(source.verdict || '').trim(),
    userFeedback,
    String(source.draftExcerpt || source.excerpt || '').trim(),
    String(source.source || 'writer-engine.feedback_endpoint').trim(),
    new Date().toISOString(),
  );
  return {
    stored: true,
    chars: userFeedback.length,
    responseId: Number(info.lastInsertRowid),
  };
}

function unwrapStoredArticleResult(value: unknown): unknown {
  const item = readObject(value);
  return item.result ?? value;
}

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseArgs(argv: string[]) { // C 类比：parse_args(argc, argv)；只负责把 --key value 转成参数表。
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : '';
    args.set(key.slice(2), value);
  }
  return args;
}

function isDirectExecution() {
  return require.main === module;
}

if (isDirectExecution()) {
  const __dirname = path.dirname(__filename);
  const workspaceRoot = path.dirname(__dirname);
  process.env.CONTENTBASE_WORKSPACE_ROOT ||= workspaceRoot;
  loadRuntimeEnv();

  const args = parseArgs(process.argv);
  const port = Number(args.get('port') || process.env.WRITER_ENGINE_PORT || process.env.CONTENTBASE_CONSOLE_PORT || 19203);
  const server = createContentBaseServer({ workspaceRoot });
  server.requestTimeout = 20 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
  server.keepAliveTimeout = 5 * 1000;
  server.listen(port, () => {
    console.log(`[writer-engine] listening on http://127.0.0.1:${port}`);
  });
}

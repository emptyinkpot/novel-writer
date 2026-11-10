// 文章任务控制台源码：渲染 /article-jobs 页面，方便查看和轮询异步生成任务。
// 这里只输出管理界面 HTML，不承载生成逻辑。
export function renderArticleJobConsole() {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ContentBase Article Jobs</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #5f6b7a;
      --line: #d9dee7;
      --accent: #0f766e;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 24px auto;
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      gap: 16px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
    }
    .panel { padding: 16px; }
    h1 {
      margin: 0 0 14px;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    label {
      display: block;
      margin: 12px 0 6px;
      color: var(--muted);
      font-size: 13px;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      color: var(--ink);
      background: #fff;
    }
    textarea { min-height: 280px; resize: vertical; }
    button, a.button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      padding: 0 12px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
    }
    button.secondary, a.button.secondary {
      background: #fff;
      color: var(--accent);
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .status {
      margin-top: 12px;
      padding: 10px;
      border-radius: 6px;
      background: #f3f6f8;
      color: var(--muted);
      min-height: 42px;
      word-break: break-word;
    }
    .status.error { color: var(--danger); background: #fff4f2; }
    .resultHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
    }
    .meta { color: var(--muted); font-size: 13px; }
    pre {
      margin: 0;
      padding: 16px;
      min-height: 600px;
      max-height: calc(100vh - 130px);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font: 15px/1.7 "Microsoft YaHei", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
    }
    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; width: min(100vw - 20px, 720px); margin: 10px auto; }
      pre { max-height: none; min-height: 360px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>ContentBase Article Jobs</h1>
      <label for="jobId">Job ID</label>
      <input id="jobId" autocomplete="off" placeholder="粘贴已有 job id，或提交新任务后自动填入">
      <div class="actions">
        <button id="loadJob" class="secondary" type="button">查询</button>
        <button id="loadResult" class="secondary" type="button">取结果</button>
        <a id="download" class="button secondary" href="#" download hidden>下载 MD</a>
      </div>
      <label for="requestBody">生成请求 JSON</label>
      <textarea id="requestBody" spellcheck="false">{
  "input": "请写一篇关于中华是什么的长文"
}</textarea>
      <div class="actions">
        <button id="submitJob" type="button">提交任务</button>
      </div>
      <div id="status" class="status">等待提交或查询。</div>
    </section>
    <section>
      <div class="resultHeader">
        <div>
          <strong>生成正文</strong>
          <div id="meta" class="meta">未加载</div>
        </div>
      </div>
      <pre id="body"></pre>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const statusEl = $('status');
    const bodyEl = $('body');
    const metaEl = $('meta');
    const downloadEl = $('download');
    let pollTimer = null;

    function setStatus(text, error = false) {
      statusEl.textContent = text;
      statusEl.classList.toggle('error', error);
    }

    function setJobId(id) {
      $('jobId').value = id || '';
      if (id) {
        downloadEl.href = '/api/content/runtime/generate/article/jobs/' + encodeURIComponent(id) + '/download/' + encodeURIComponent(id + '.md');
        downloadEl.hidden = false;
      } else {
        downloadEl.hidden = true;
      }
    }

    async function readJsonResponse(response) {
      const text = await response.text();
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new Error('服务返回非 JSON：' + text.slice(0, 180));
      }
    }

    async function fetchJob() {
      const id = $('jobId').value.trim();
      if (!id) throw new Error('缺少 Job ID');
      const response = await fetch('/api/content/runtime/generate/article/jobs/' + encodeURIComponent(id));
      const payload = await readJsonResponse(response);
      if (!response.ok || payload.success === false) throw new Error(payload.error || '查询失败');
      return payload.data;
    }

    async function fetchResult() {
      const id = $('jobId').value.trim();
      if (!id) throw new Error('缺少 Job ID');
      const response = await fetch('/api/content/runtime/generate/article/jobs/' + encodeURIComponent(id) + '/result');
      const payload = await readJsonResponse(response);
      if (!response.ok || payload.success === false) throw new Error(payload.error || '取结果失败');
      if (response.status === 202) return { pending: true, job: payload.data };
      return { pending: false, result: payload.data };
    }

    async function refreshJob() {
      try {
        const job = await fetchJob();
        setStatus((job.status || '') + ' / ' + (job.stage || '') + ': ' + (job.lastMessage || ''));
        if (job.status === 'finished') {
          clearInterval(pollTimer);
          await refreshResult();
        }
        if (job.status === 'failed') {
          clearInterval(pollTimer);
          setStatus(job.error || job.lastMessage || '任务失败', true);
        }
      } catch (error) {
        clearInterval(pollTimer);
        setStatus(error.message, true);
      }
    }

    async function refreshResult() {
      try {
        const data = await fetchResult();
        if (data.pending) {
          const job = data.job || {};
          setStatus((job.status || '') + ' / ' + (job.stage || '') + ': ' + (job.lastMessage || ''));
          return;
        }
        const draft = data.result?.draft || {};
        const body = String(draft.body || '');
        bodyEl.textContent = body;
        metaEl.textContent = 'chars=' + body.length + ' continuations=' + (draft.continuations ?? 'n/a') + ' minimum=' + (draft.minimumWordCount ?? 'n/a');
        setStatus('结果已加载，可直接下载 MD。');
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    $('submitJob').addEventListener('click', async () => {
      clearInterval(pollTimer);
      try {
        const input = JSON.parse($('requestBody').value);
        setStatus('提交中...');
        const response = await fetch('/api/content/runtime/generate/article/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok || payload.success === false) throw new Error(payload.error || '提交失败');
        setJobId(payload.data.id);
        setStatus((payload.data.status || '') + ' / ' + (payload.data.stage || '') + ': ' + (payload.data.lastMessage || ''));
        pollTimer = setInterval(refreshJob, 5000);
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    $('loadJob').addEventListener('click', refreshJob);
    $('loadResult').addEventListener('click', refreshResult);
  </script>
</body>
</html>`;
}

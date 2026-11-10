// Writer 调用源码：构造 Writer 系统约束并执行唯一的模型正文生成调用。
// 这里不选择业务事实，不做多 Writer 编排，也不从请求里接受模型覆盖。
import { getWriterModelService, requireModelService } from '../../../config/env.ts';
import type { ModelServiceConfig } from '../../../config/env.ts';
import { WRITER_SYSTEM_PROMPT } from '../../agents/prompts/shared/system-prompt.mjs';

export type WriterResult = {
  body: string;
  trace: {
    provider: string;
    model: string;
    baseUrl: string;
    usage: any;
    finishedAt: string;
    transport?: 'stream' | 'non_stream';
    streamReads?: number;
    dataChunks?: number;
    contentChunks?: number;
    firstContentAt?: string;
    finishReason?: 'stop' | 'content_idle';
  };
};

type WriterProgressEvent = {
  stage: string;
  message: string;
};

type WriterOptions = {
  signal?: AbortSignal;
  systemPrompt?: string;
  onProgress?: (event: WriterProgressEvent) => void;
};

export async function callSingleWriter(prompt: string, settings?: Record<string, any>, options?: WriterOptions): Promise<WriterResult> {
  const requestedService = isModelServiceConfig(settings?.modelService) ? settings.modelService : getWriterModelService();
  const { baseUrl, apiKey, model } = requireModelService(requestedService, 'CONTENTBASE_LLM');
  const callLabel = String(settings?.agentName || 'writer');
  const systemPrompt = String(options?.systemPrompt || WRITER_SYSTEM_PROMPT);

  const maxRetries = 2;
  const reportProgress = createWriterProgressReporter(options?.onProgress);
  const requestTimeoutMs = readPositiveIntegerSetting(
    settings?.requestTimeoutMs ?? settings?.timeoutMs,
    readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_REQUEST_TIMEOUT_MS') ?? 330_000,
  );
  const idleTimeoutMs = readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_IDLE_TIMEOUT_MS') ?? 60_000;
  // 首 token 超时：首个 content delta 到达前的等待窗口，与外层 generation runtime 的 330s 写作超时对齐。
  // 模型在长 prompt 下思考几十秒才吐首 token 是正常的；用这个宽容窗口守护首 token 前，
  // 避免被 60s 的 content-idle 误杀。首 token 之后才切到 idleTimeoutMs 计“无 delta 卡住”。
  const firstTokenTimeoutMs = readPositiveIntegerSetting(
    settings?.requestTimeoutMs ?? settings?.timeoutMs,
    readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_FIRST_TOKEN_TIMEOUT_MS') ?? 330_000,
  );
  const partialContentMinChars = readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_PARTIAL_MIN_CHARS') ?? 800;
  const allowPartialContent = settings?.allowPartialContent === true;
  if (shouldUseNonStreamWriter(prompt, settings)) {
    return callNonStreamWriter({
      baseUrl,
      apiKey,
      model,
      prompt,
      systemPrompt,
      settings,
      signal: options?.signal,
      reportProgress,
      callLabel,
    });
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      throwIfAborted(options?.signal);
      reportProgress('writer_request', `Opening writer stream agent=${callLabel} attempt ${attempt + 1}`);
      const requestAbort = new AbortController();
      const detachAbort = linkAbortSignal(options?.signal, requestAbort);
      const response = await withTimeout(fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: Number.isFinite(Number(settings?.temperature)) ? Number(settings.temperature) : 0.4,
            max_tokens: Number.isFinite(Number(settings?.maxTokens)) && Number(settings.maxTokens) > 0
              ? Math.trunc(Number(settings.maxTokens)) : 4096,
            stream: true,
          }),
          signal: requestAbort.signal,
        }), requestTimeoutMs, () => {
          requestAbort.abort();
          reportProgress('writer_request_timeout', `Writer stream agent=${callLabel} open timed out after ${requestTimeoutMs}ms`);
        });
      reportProgress('writer_response', `Writer gateway returned HTTP ${response.status} agent=${callLabel} attempt ${attempt + 1}`);
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        detachAbort();
        if (attempt < maxRetries) continue;
        throw new Error(`LLM gateway returned HTTP ${response.status}: ${errText.slice(0, 240)}`);
      }
      let fullContent = '';
      let usage: any = null;
      const reader = (response.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamReads = 0;
      let dataChunks = 0;
      let contentChunks = 0;
      let firstContentAt = '';
      let lastContentAtMs = 0;
      let finishReason: WriterResult['trace']['finishReason'] = 'stop';
      let contentIdleTimer: ReturnType<typeof setTimeout> | undefined;
      const clearContentIdleTimer = () => {
        if (contentIdleTimer) clearTimeout(contentIdleTimer);
        contentIdleTimer = undefined;
      };
      const armContentIdleTimer = () => {
        clearContentIdleTimer();
        // 首 token 前用宽容的 firstTokenTimeoutMs；首 token 后才用 idleTimeoutMs 计“无 delta 卡住”。
        const windowMs = firstContentAt ? idleTimeoutMs : firstTokenTimeoutMs;
        if (!windowMs) return;
        contentIdleTimer = setTimeout(() => {
          const err = new Error('Writer stream content idle');
          const phase = firstContentAt ? 'no content delta' : 'no first token';
          reportProgress('writer_stalled', `Writer stream agent=${callLabel} ${phase} for ${windowMs}ms chars=${fullContent.length}`);
          requestAbort.abort(err);
          reader.cancel?.(err).catch?.(() => {});
        }, windowMs);
      };
      try {
        armContentIdleTimer();
        while (true) {
          throwIfAborted(options?.signal);
          let readResult: any;
          try {
            // 首 token 前用宽容的 firstTokenTimeoutMs;首 token 后才用 idleTimeoutMs 计单次 read 卡住,与 armContentIdleTimer 同窗口口径。
            const readWindowMs = firstContentAt ? idleTimeoutMs : firstTokenTimeoutMs;
            readResult = await readStreamChunk(reader, readWindowMs, options?.signal, () => {
              reportProgress('writer_stalled', `Writer stream agent=${callLabel} stalled after last read chars=${fullContent.length}`);
              requestAbort.abort(new Error('Writer stream stalled'));
            });
          } catch (err) {
            if (allowPartialContent && isWriterStreamIdleError(err) && fullContent.trim().length >= partialContentMinChars) {
              finishReason = 'content_idle';
              reportProgress('writer_partial', `Writer stream agent=${callLabel} stalled; returning partial content chars=${fullContent.length}`);
              await reader.cancel?.(err).catch?.(() => {});
              break;
            }
            throw err;
          }
          const { done, value } = readResult;
          if (done) {
            if (allowPartialContent && requestAbort.signal.aborted && fullContent.trim().length >= partialContentMinChars) {
              finishReason = 'content_idle';
              reportProgress('writer_partial', `Writer stream agent=${callLabel} ended after content idle; returning partial content chars=${fullContent.length}`);
            }
            break;
          }
          streamReads++;
          if (streamReads === 1) {
            reportProgress('writer_stream', `Writer stream agent=${callLabel} received first bytes`);
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const chunk = JSON.parse(data);
              dataChunks++;
              const delta = extractStreamTextDelta(chunk);
              if (delta) {
                if (!firstContentAt) {
                  firstContentAt = new Date().toISOString();
                  reportProgress('writer_first_token', `Writer stream agent=${callLabel} received first content token`);
                }
                fullContent += delta;
                contentChunks++;
                lastContentAtMs = Date.now();
                armContentIdleTimer();
                if (contentChunks === 1 || contentChunks % 50 === 0) {
                  reportProgress('writer_stream', `Writer stream agent=${callLabel} content chunks=${contentChunks} chars=${fullContent.length}`);
                }
              }
              if (chunk.usage) usage = chunk.usage;
            } catch {}
          }
          if (firstContentAt && idleTimeoutMs && Date.now() - lastContentAtMs >= idleTimeoutMs) {
            reportProgress('writer_stalled', `Writer stream agent=${callLabel} no content delta for ${idleTimeoutMs}ms chars=${fullContent.length}`);
            const err = new Error('Writer stream content idle');
            requestAbort.abort(err);
            await reader.cancel?.(err).catch?.(() => {});
            throw err;
          }
        }
      } finally {
        clearContentIdleTimer();
        detachAbort();
      }
      reportProgress('writer_done', `Writer stream agent=${callLabel} ended reads=${streamReads} dataChunks=${dataChunks} contentChunks=${contentChunks} chars=${fullContent.length} finishReason=${finishReason}`);
      if (!fullContent && attempt < maxRetries) continue;
      if (!fullContent) throw new Error(`Writer stream ended without content agent=${callLabel}`);
      if (requestAbort.signal.aborted && (!allowPartialContent || fullContent.trim().length < partialContentMinChars)) {
        throw toAbortError(requestAbort.signal.reason);
      }
      return {
        body: fullContent,
        trace: { provider: 'openai-compatible', model, baseUrl, usage, finishedAt: new Date().toISOString(), transport: 'stream', streamReads, dataChunks, contentChunks, firstContentAt, finishReason },
      };
    } catch (err) {
      reportProgress('writer_error', `Writer agent=${callLabel} attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (options?.signal?.aborted) throw err;
      if (attempt < maxRetries) continue;
      throw err;
    }
  }
  throw new Error('callSingleWriter: all retries exhausted');
}

function isModelServiceConfig(value: unknown): value is ModelServiceConfig {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return typeof source.baseUrl === 'string'
    && typeof source.apiKey === 'string'
    && typeof source.model === 'string';
}

async function callNonStreamWriter(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  settings?: Record<string, any>;
  signal?: AbortSignal;
  reportProgress: (stage: string, message: string) => void;
  callLabel: string;
}): Promise<WriterResult> {
  const timeoutMs = readPositiveIntegerSetting(
    input.settings?.requestTimeoutMs ?? input.settings?.timeoutMs,
    readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_NON_STREAM_TIMEOUT_MS') ?? 330_000,
  );
  const requestAbort = new AbortController();
  const detachAbort = linkAbortSignal(input.signal, requestAbort);
  try {
    throwIfAborted(input.signal);
    const maxTokens = resolveWriterMaxTokens(input.settings);
    const outputCapOverride = readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_NON_STREAM_MAX_OUTPUT_TOKENS');
    const effectiveMaxTokens = outputCapOverride ? Math.min(maxTokens, outputCapOverride) : maxTokens;
    input.reportProgress('writer_non_stream_request', `Opening non-stream writer request agent=${input.callLabel} timeout=${timeoutMs}ms maxTokens=${effectiveMaxTokens}`);
    const response = await withTimeout(fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        temperature: Number.isFinite(Number(input.settings?.temperature)) ? Number(input.settings.temperature) : 0.4,
        max_tokens: effectiveMaxTokens,
        stream: false,
      }),
      signal: requestAbort.signal,
    }), timeoutMs, () => {
      requestAbort.abort();
      input.reportProgress('writer_non_stream_timeout', `Non-stream writer request agent=${input.callLabel} timed out after ${timeoutMs}ms`);
    });
    input.reportProgress('writer_non_stream_response', `Non-stream writer gateway returned HTTP ${response.status} agent=${input.callLabel}`);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`LLM gateway returned HTTP ${response.status}: ${errText.slice(0, 240)}`);
    }
    const payload: any = await response.json();
    const body = extractCompletionText(payload).trim();
    if (!body) {
      throw new Error(`Non-stream writer returned no content agent=${input.callLabel}`);
    }
    input.reportProgress('writer_non_stream_done', `Non-stream writer agent=${input.callLabel} returned chars=${body.length}`);
    return {
      body,
      trace: {
        provider: 'openai-compatible',
        model: input.model,
        baseUrl: input.baseUrl,
        usage: payload?.usage ?? null,
        finishedAt: new Date().toISOString(),
        transport: 'non_stream',
        finishReason: 'stop',
      },
    };
  } finally {
    detachAbort();
  }
}

function resolveWriterMaxTokens(settings?: Record<string, any>) {
  const parsed = Number(settings?.maxTokens);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 4096;
}

function extractCompletionText(payload: any): string {
  const choice = payload?.choices?.[0];
  return extractTextContent(choice?.message?.content)
    || extractTextContent(choice?.text)
    || extractTextContent(payload?.content)
    || extractTextContent(payload?.completion)
    || '';
}

function extractStreamTextDelta(chunk: any): string {
  const choice = chunk?.choices?.[0];
  return extractTextContent(choice?.delta?.content)
    || extractTextContent(choice?.delta?.text)
    || extractTextContent(choice?.message?.content)
    || extractTextContent(chunk?.delta?.text)
    || extractTextContent(chunk?.content_block?.text)
    || extractTextContent(chunk?.completion)
    || '';
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractTextContent(item)).join('');
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return extractTextContent(source.text)
      || extractTextContent(source.content)
      || extractTextContent(source.value);
  }
  return '';
}

function shouldUseNonStreamWriter(prompt: string, settings?: Record<string, any>) {
  if (String(process.env.CONTENTBASE_WRITER_FORCE_STREAM || '').trim() === '1') return false;
  if (settings?.stream === true) return false;
  if (settings?.stream === false) return true;
  const promptThreshold = readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_NON_STREAM_PROMPT_CHARS') ?? 30_000;
  const tokenThreshold = readOptionalPositiveIntegerEnv('CONTENTBASE_WRITER_NON_STREAM_MAX_TOKENS') ?? 8_000;
  const maxTokens = Number(settings?.maxTokens);
  return String(prompt || '').length >= promptThreshold
    || (Number.isFinite(maxTokens) && maxTokens >= tokenThreshold);
}

function isWriterStreamIdleError(err: unknown) {
  return err instanceof Error && (err.message === 'Writer stream stalled' || err.message === 'Writer stream content idle');
}

function createWriterProgressReporter(onProgress?: (event: WriterProgressEvent) => void) {
  return (stage: string, message: string) => {
    if (typeof onProgress === 'function') {
      onProgress({ stage, message });
    }
  };
}

async function readStreamChunk(reader: any, idleTimeoutMs: number | undefined, signal: AbortSignal | undefined, onIdle: () => void) {
  throwIfAborted(signal);
  if (!idleTimeoutMs && !signal) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        if (!signal) return;
        detachAbort = onAbort(signal, () => {
          reader.cancel?.(signal.reason).catch?.(() => {});
          reject(toAbortError(signal.reason));
        });
      }),
      new Promise((_, reject) => {
        if (!idleTimeoutMs) return;
        timer = setTimeout(() => {
          onIdle();
          reject(new Error('Writer stream stalled'));
        }, idleTimeoutMs);
      }),
    ]);
    throwIfAborted(signal);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    detachAbort?.();
  }
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController) {
  if (!source) return () => {};
  return onAbort(source, () => target.abort(source.reason));
}

function onAbort(signal: AbortSignal, callback: () => void) {
  if (signal.aborted) {
    callback();
    return () => {};
  }
  signal.addEventListener('abort', callback, { once: true });
  return () => signal.removeEventListener('abort', callback);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw toAbortError(signal.reason);
}

function toAbortError(reason: unknown) {
  return reason instanceof Error ? reason : new Error(reason ? String(reason) : 'Writer aborted');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout();
          } catch {}
          reject(new Error(`Writer request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readOptionalPositiveIntegerEnv(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function readPositiveIntegerSetting(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : defaultValue;
}

// 产品 HTTP 客户端源码：提供带超时、错误信息和 JSON 解析的统一 requestJson。
// Gateway、STORM 等外部调用复用这里，避免每个模块重复写 fetch 细节。
export type JsonRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  label?: string;
  signal?: AbortSignal;
};

export async function requestJson<T = Record<string, any>>(
  url: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const label = options.label || 'request';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60_000);
  const detachAbort = linkAbortSignal(options.signal, controller);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      signal: controller.signal,
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const parsed = parseJsonResponse(text, response.status, label);
    if (!response.ok) {
      const msg = String((parsed as any).message || (parsed as any).error || text).slice(0, 240);
      throw new Error(`${label} returned HTTP ${response.status}: ${msg}`);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof Error) throw new Error(`${label} unavailable: ${error.message}`);
    throw new Error(`${label} unavailable: ${String(error)}`);
  } finally {
    detachAbort();
    clearTimeout(timeout);
  }
}

function parseJsonResponse(text: string, status: number, label: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON: HTTP ${status}`);
  }
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => {};
  const abort = () => target.abort(source.reason);
  if (source.aborted) {
    abort();
    return () => {};
  }
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

// DataBase Gateway 客户端源码：封装 EvidencePack、语料检索、向量检索等 Gateway HTTP 调用。
// 上层上下文引擎只表达检索意图，认证头、baseUrl、JSON 请求细节留在这里。
import { getDatabaseGatewayService, normalizeBaseUrl } from '../../../config/env.ts';
import { requestJson } from '../http/http-client.ts';

// ContentBase 访问 DataBase Gateway 的唯一文章领域客户端。
// 它不决定“查什么材料”，只负责把 context/context-builder.ts 的检索请求变成 HTTP 请求。
export class DataBaseGatewayClient {
  private baseUrl: string; // DataBase Gateway 根地址，例如 https://database.example.invalid。
  private apiKey: string; // Gateway API key；只放进请求头，不在这里打印。
  private headerName: string; // API key header 名，默认 X-DataBase-Api-Key。
  private defaultTimeout: number; // 单次 Gateway 请求默认超时时间，毫秒。

  constructor(opts?: { baseUrl?: string; apiKey?: string; headerName?: string; timeout?: number }) {
    // 默认从 src/config/env.ts 读取 Coolify 注入的 process.env；测试时可用 opts 覆盖。
    const service = getDatabaseGatewayService(opts);
    this.baseUrl = normalizeBaseUrl(service.baseUrl);
    this.apiKey = service.apiKey;
    this.headerName = service.headerName;
    this.defaultTimeout = opts?.timeout || 240000;
  }

  get url(): string { return this.baseUrl; }

  private headers(extra?: Record<string, string>): Record<string, string> | undefined {
    // 统一拼 Gateway 请求头：业务方法不用关心 API key 放在哪个 header。
    const headers = {
      ...(extra || {}),
      ...(this.apiKey ? { [this.headerName]: this.apiKey } : {}),
    };
    return Object.keys(headers).length ? headers : undefined;
  }

  async getJson<T = Record<string, any>>(
    path: string,
    params?: Record<string, string>,
    label = 'gateway',
    ragflowDatasetIds: string[] = [],
    timeoutMs?: number,
  ): Promise<T> {
    // 通用 GET：拼 query string、追加 ragflowDatasetIds、交给 requestJson 做 fetch/超时/错误处理。
    const urlParams = new URLSearchParams(params || {});
    for (const id of ragflowDatasetIds) urlParams.append('ragflowDatasetIds', id);
    return requestJson<T>(`${this.baseUrl}${path}?${urlParams.toString()}`, {
      headers: this.headers(),
      timeoutMs: timeoutMs || this.defaultTimeout,
      label,
    });
  }

  async postJson<T = Record<string, any>>(
    path: string,
    body?: Record<string, any>,
    label = 'gateway',
    timeoutMs?: number,
  ): Promise<T> {
    // 通用 POST：主要给 vector batch 这类 JSON body 接口用。
    return requestJson<T>(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body,
      timeoutMs: timeoutMs || this.defaultTimeout,
      label,
    });
  }

  searchEvidence<T = Record<string, any>>(
    params: Record<string, string>,
    ragflowDatasetIds: string[],
    timeoutMs?: number,
  ): Promise<T> {
    // Reality 事实证据入口：DataBase Gateway 在这里聚合 web/RAGFlow/private corpus。
    return this.getJson<T>('/evidence/search', params, 'evidence search', ragflowDatasetIds, timeoutMs);
  }

  searchVectorBatch<T = Record<string, any>>(
    queries: Array<{ q: string; limit: number; tag: string }>,
    timeoutMs?: number,
  ): Promise<T> {
    // 批量语料召回入口：一次提交多个 query，用于文风、主题、发现性语料补充。
    return this.postJson<T>('/search/vector/batch', { queries }, 'batch vector search', timeoutMs);
  }

  searchVector<T = Record<string, any>>(
    params: Record<string, string>,
    label = 'vector search',
    timeoutMs?: number,
  ): Promise<T> {
    // 单条向量搜索入口：当前主要给 association expansion 按联想词找补充材料。
    return this.getJson<T>('/search/vector', params, label, [], timeoutMs);
  }
}

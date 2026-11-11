// 唯一运行时 env 读取层：先读 process.env，再加载仓库根目录的 .env（可选，已 gitignore）。
// 项目只认识自己：没有任何外部网关配置；模型接口与整个项目共用 LLM_* 变量。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '../storage/local-db.ts';

export type ModelServiceConfig = {
  baseUrl: string; // OpenAI-compatible /chat/completions 根地址。
  apiKey: string; // Writer 或研究模型密钥。
  model: string; // 实际调用的模型名。
};

export type StormResearchConfig = {
  enabled: boolean;
  required: boolean;
  url: string;
  timeoutMs: number;
};

export function loadRuntimeEnv(): void {
  loadEnvFile(join(findRepoRoot(), '.env'));
}

export function getRuntimeEnvDiagnostics(): Record<string, any> {
  // /api/corpus/diagnostics 调这里；只返回“是否配置”和脱敏地址，不泄露 secret。
  const writer = getWriterModelService();
  return {
    writer: {
      baseUrl: writer.baseUrl ? redactUrl(writer.baseUrl) : 'not configured',
      apiKey: writer.apiKey ? 'configured' : 'not configured',
      model: writer.model || 'not configured',
    },
    corpus: 'local sqlite (data/writer-engine.sqlite)',
    storm: getStormResearchDiagnostics(),
  };
}

export function getWriterModelService(): ModelServiceConfig {
  // 唯一正文 Writer；model/writer-model.ts 只从这里拿模型配置，不接受请求覆盖模型。
  const profile = readEnv('CONTENTBASE_LLM_PROFILE').toUpperCase();
  if (profile) {
    const profiled = getProfiledModelService('CONTENTBASE_LLM', profile);
    if (profiled.baseUrl || profiled.apiKey || profiled.model) return profiled;
  }
  // 未单独配置 writer-engine 时，复用整个项目的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。
  return {
    baseUrl: normalizeBaseUrl(readEnv('CONTENTBASE_LLM_BASE_URL') || readEnv('LLM_BASE_URL')),
    apiKey: readEnv('CONTENTBASE_LLM_API_KEY') || readEnv('LLM_API_KEY'),
    model: readEnv('CONTENTBASE_LLM_MODEL') || readEnv('LLM_MODEL'),
  };
}

export function getNamedModelService(profile: string): ModelServiceConfig {
  // Agent 专用模型选择：profile 为空才复用 Writer；显式命名 profile 必须完整，禁止混用 Writer 补缺项。
  const writer = getWriterModelService();
  const normalized = String(profile || '').trim().toUpperCase();
  if (!normalized || normalized === 'WRITER' || normalized === 'DEFAULT') return writer;
  const profiled = getProfiledModelService('CONTENTBASE_LLM', normalized);
  return profiled;
}

export function getNamedModelDiagnostics(profile: string): Record<string, any> {
  const config = getNamedModelService(profile);
  return {
    profile: String(profile || 'writer').trim() || 'writer',
    model: config.model || 'not configured',
    baseUrl: config.baseUrl ? redactUrl(config.baseUrl) : 'not configured',
    apiKey: config.apiKey ? 'configured' : 'not configured',
  };
}

export function getResearchModelService(): ModelServiceConfig {
  // 只用于生成检索 query；未配置时复用 Writer 配置。
  const writer = getWriterModelService();
  return {
    baseUrl: normalizeBaseUrl(readEnv('CONTENTBASE_RESEARCH_LLM_BASE_URL') || writer.baseUrl),
    apiKey: readEnv('CONTENTBASE_RESEARCH_LLM_API_KEY') || writer.apiKey,
    model: readEnv('CONTENTBASE_RESEARCH_LLM_MODEL') || writer.model || 'gpt-5.5',
  };
}

export function getAssociationModelService(): ModelServiceConfig {
  // 只用于联想扩展词；优先专用配置，再退到 research/Writer。
  const research = getResearchModelService();
  return {
    baseUrl: normalizeBaseUrl(readEnv('CONTENTBASE_ASSOC_LLM_BASE_URL') || research.baseUrl),
    apiKey: readEnv('CONTENTBASE_ASSOC_LLM_API_KEY') || research.apiKey,
    model: readEnv('CONTENTBASE_ASSOC_LLM_MODEL') || research.model,
  };
}

export function getContextWindowModel(requestModel?: string): string {
  // 只用于估算上下文窗口；不代表 Writer 可以被请求动态换模型。
  return String(requestModel || getWriterModelService().model || '').trim();
}

export function getStormResearchConfig(): StormResearchConfig {
  const url = normalizeBaseUrl(readEnv('CONTENTBASE_STORM_RESEARCH_URL'));
  const enabled = readBooleanEnv('CONTENTBASE_STORM_ENABLED', Boolean(url));
  return {
    enabled,
    required: readBooleanEnv('CONTENTBASE_STORM_REQUIRED', enabled),
    url,
    timeoutMs: readPositiveIntegerEnv('CONTENTBASE_STORM_TIMEOUT_MS', 90_000),
  };
}

export function requireModelService(config: ModelServiceConfig, label: string): ModelServiceConfig {
  // 模型调用前的硬校验：缺 baseUrl/apiKey/model 就直接失败，避免静默空跑。
  if (!config.baseUrl) throw new Error(`${label}_BASE_URL is required`);
  if (!config.apiKey) throw new Error(`${label}_API_KEY is required`);
  if (!config.model) throw new Error(`${label}_MODEL is required`);
  return config;
}

export function getWriterServiceDiagnostics(): Record<string, any> {
  // corpus diagnostics 页面展示 Writer 配置状态；apiKey 永远只显示 configured。
  const writer = getWriterModelService();
  return {
    model: writer.model || 'not configured',
    baseUrl: writer.baseUrl ? redactUrl(writer.baseUrl) : 'not configured',
    apiKey: writer.apiKey ? '***configured***' : 'not configured',
  };
}

export function normalizeBaseUrl(value: string): string {
  // 所有服务根地址去掉末尾斜杠，调用方再拼 /path。
  return String(value || '').trim().replace(/\/+$/, '');
}

function readEnv(key: string): string {
  // 唯一的 process.env 读取小口；返回 trim 后字符串，未配置就是空串。
  return String(process.env[key] || '').trim();
}

function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const value = readEnv(key).toLowerCase();
  if (!value) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

function readPositiveIntegerEnv(key: string, defaultValue: number): number {
  const parsed = Number(readEnv(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : defaultValue;
}

function getStormResearchDiagnostics(): Record<string, any> {
  const config = getStormResearchConfig();
  return {
    enabled: config.enabled,
    required: config.required,
    url: config.url ? redactUrl(config.url) : 'not configured',
    timeoutMs: config.timeoutMs,
  };
}

function getProfiledModelService(prefix: string, profile: string): ModelServiceConfig {
  return {
    baseUrl: normalizeBaseUrl(readEnv(`${prefix}_${profile}_BASE_URL`)),
    apiKey: readEnv(`${prefix}_${profile}_API_KEY`),
    model: readEnv(`${prefix}_${profile}_MODEL`),
  };
}

function redactUrl(value: string): string {
  // 诊断里可以看 host/path，但不输出 query、token 等敏感细节。
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'configured';
  }
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!key || !value || value.startsWith('replace-with-')) continue;
    process.env[key] ||= value;
  }
}

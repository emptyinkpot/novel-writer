// Agent model config adapter：读取 article/registry/agents.ts，再叠加 env model/profile 覆盖。
// 注册表本体不在这里；这里只负责 profile 可用性、modelService 和运行参数。
import { getNamedModelDiagnostics, getNamedModelService } from '../../config/env.ts';
import type { ModelServiceConfig } from '../../config/env.ts';
import { ARTICLE_AGENT_REGISTRY } from '../registry/agents.ts';
import type { ArticleAgentConfig, ArticleAgentName } from '../registry/agents.ts';

export type { ArticleAgentConfig, ArticleAgentName } from '../registry/agents.ts';

export function getArticleAgentConfig(name: ArticleAgentName): ArticleAgentConfig {
  const base = ARTICLE_AGENT_REGISTRY[name];
  const envPrefix = `CONTENTBASE_AGENT_${name.toUpperCase()}`;
  const explicitProfile = readStringEnv(`${envPrefix}_PROFILE`, '');
  // 注册表里的 profile 只是偏好：没配置对应模型时退回项目通用模型（LLM_*）。
  // 通过环境变量显式指定的 profile 不完整则报错，避免配置错误被悄悄掩盖。
  const requestedProfile = explicitProfile || (isNamedProfileConfigured(base.profile) ? base.profile : 'writer');
  assertNamedProfileUsable(requestedProfile, name);
  return {
    ...base,
    profile: requestedProfile,
    temperature: readNumberEnv(`${envPrefix}_TEMPERATURE`, base.temperature),
    maxTokens: readIntegerEnv(`${envPrefix}_MAX_TOKENS`, base.maxTokens),
    stream: readBooleanEnv(`${envPrefix}_STREAM`, base.stream),
  };
}

export function buildAgentSettings(name: ArticleAgentName, overrides?: Record<string, unknown>): Record<string, unknown> {
  const config = getArticleAgentConfig(name);
  return {
    maxTokens: config.maxTokens,
    stream: config.stream,
    temperature: config.temperature,
    modelService: getArticleAgentModelService(name),
    agentName: name,
    ...overrides,
  };
}

export function getArticleAgentSystemPrompt(name: ArticleAgentName): string {
  return getArticleAgentConfig(name).systemPrompt;
}

export function getArticleAgentModelService(name: ArticleAgentName): ModelServiceConfig {
  return getNamedModelService(getArticleAgentConfig(name).profile);
}

export function getArticleAgentDiagnostics(): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {};
  for (const name of Object.keys(ARTICLE_AGENT_REGISTRY) as ArticleAgentName[]) {
    const config = getArticleAgentConfig(name);
    diagnostics[name] = {
      canonicalName: config.canonicalName,
      stage: config.stage,
      status: config.status,
      kind: config.kind,
      profile: config.profile,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      stream: config.stream,
      bodyMutation: config.bodyMutation,
      factAuthority: config.factAuthority,
      role: config.role,
      rationale: config.rationale,
      model: getNamedModelDiagnostics(config.profile),
    };
  }
  return diagnostics;
}

function readStringEnv(key: string, fallback: string): string {
  return String(process.env[key] || '').trim() || fallback;
}

function readNumberEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function readIntegerEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function readBooleanEnv(key: string, fallback: boolean): boolean {
  const value = String(process.env[key] || '').trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function isNamedProfileConfigured(profile: string): boolean {
  const normalized = String(profile || '').trim().toUpperCase();
  if (!normalized || normalized === 'WRITER' || normalized === 'DEFAULT') return true;
  return ['BASE_URL', 'API_KEY', 'MODEL'].every((suffix) => String(process.env[`CONTENTBASE_LLM_${normalized}_${suffix}`] || '').trim());
}

function assertNamedProfileUsable(profile: string, agentName: ArticleAgentName): void {
  const normalized = String(profile || '').trim().toUpperCase();
  if (!normalized || normalized === 'WRITER' || normalized === 'DEFAULT') return;
  const missing = [
    `CONTENTBASE_LLM_${normalized}_BASE_URL`,
    `CONTENTBASE_LLM_${normalized}_API_KEY`,
    `CONTENTBASE_LLM_${normalized}_MODEL`,
  ].filter((key) => !String(process.env[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Agent ${agentName} requires profile ${profile}, but missing env: ${missing.join(', ')}`);
  }
}

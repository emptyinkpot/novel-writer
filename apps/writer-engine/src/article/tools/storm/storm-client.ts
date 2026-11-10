// STORM 研究规划客户端：只做写作前研究视角和检索问题规划。
// STORM 不提供最终事实权威；事实仍以 DataBase Gateway / EvidencePack 的 Reality 为准。
import { getStormResearchConfig } from '../../../config/env.ts';
import { requestJson } from '../http/http-client.ts';
import type { StormResearchResult } from '../../contracts.ts';
import { buildLocalStormResearch } from './storm-research-engine.ts';

export async function callStormResearch(input: {
  topic: string;
  target?: string;
  signal?: AbortSignal;
}): Promise<StormResearchResult | null> {
  const config = getStormResearchConfig();
  if (!config.enabled) return null;
  if (!config.url) return buildLocalStormResearch(input);
  return await requestJson<StormResearchResult>(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      topic: input.topic,
      target: input.target || '',
      genre: 'article',
      n_perspectives: 4,
      n_questions_per: 3,
    },
    timeoutMs: config.timeoutMs,
    label: 'storm research',
    signal: input.signal,
  });
}

import { buildDivergenceAgentPrompt } from '../prompts/planning/material-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import { writeAgentPromptDebugSnapshot } from '../shared/debug.ts';
import type { AgentCall, ArticleAgentInput, DivergenceNotes } from '../../contracts.ts';

export async function runDivergenceAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<DivergenceNotes> {
  const prompt = buildDivergenceAgentPrompt(input);
  writeAgentPromptDebugSnapshot('divergence_agent', prompt);
  const result = await input.callAgent(prompt, buildAgentSettings('divergence_agent'), {
    signal: input.signal,
    systemPrompt: getArticleAgentSystemPrompt('divergence_agent'),
    onProgress: input.onProgress,
  });
  return { kind: 'divergence_notes', text: String(result.body || '').trim() };
}

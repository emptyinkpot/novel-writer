import { buildFactAgentPrompt } from '../prompts/planning/material-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import { writeAgentPromptDebugSnapshot } from '../shared/debug.ts';
import type { AgentCall, ArticleAgentInput, FactNotes } from '../../contracts.ts';

export async function runFactAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<FactNotes> {
  const prompt = buildFactAgentPrompt(input);
  writeAgentPromptDebugSnapshot('fact_agent', prompt);
  const result = await input.callAgent(prompt, buildAgentSettings('fact_agent'), {
    signal: input.signal,
    systemPrompt: getArticleAgentSystemPrompt('fact_agent'),
    onProgress: input.onProgress,
  });
  return { kind: 'fact_notes', text: String(result.body || '').trim() };
}

import { buildWebRealityAgentPrompt } from '../prompts/planning/material-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import { writeAgentPromptDebugSnapshot } from '../shared/debug.ts';
import type { AgentCall, ArticleAgentInput, WebRealityNotes } from '../../contracts.ts';

export async function runWebRealityAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<WebRealityNotes> {
  const prompt = buildWebRealityAgentPrompt(input);
  writeAgentPromptDebugSnapshot('web_reality_agent', prompt);
  const result = await input.callAgent(prompt, buildAgentSettings('web_reality_agent'), {
    signal: input.signal,
    systemPrompt: getArticleAgentSystemPrompt('web_reality_agent'),
    onProgress: input.onProgress,
  });
  return { kind: 'web_reality_notes', text: String(result.body || '').trim() };
}

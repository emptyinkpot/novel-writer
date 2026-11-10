import { buildMeaningAgentPrompt } from '../prompts/planning/material-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import { writeAgentPromptDebugSnapshot } from '../shared/debug.ts';
import type { AgentCall, ArticleAgentInput, DivergenceNotes, FactNotes, MeaningNotes, WebRealityNotes } from '../../contracts.ts';

export async function runContextSynthesizer(input: ArticleAgentInput & {
  callAgent: AgentCall;
  factNotes: FactNotes;
  webRealityNotes: WebRealityNotes;
  divergenceNotes: DivergenceNotes;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<MeaningNotes> {
  const prompt = buildMeaningAgentPrompt({
    ...input,
    request: {
      ...input.request,
      __planningAgentNotes: {
        factNotes: input.factNotes.text,
        webRealityNotes: input.webRealityNotes.text,
        divergenceNotes: input.divergenceNotes.text,
      },
    },
  });
  writeAgentPromptDebugSnapshot('context_synthesizer', prompt);
  const result = await input.callAgent(prompt, buildAgentSettings('meaning_agent'), {
    signal: input.signal,
    systemPrompt: getArticleAgentSystemPrompt('meaning_agent'),
    onProgress: input.onProgress,
  });
  return { kind: 'meaning_notes', text: String(result.body || '').trim() };
}

import { buildOutlinePrompt } from '../prompts/writing/outline-prompt.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, OutlineRoute, WritingBrief } from '../../contracts.ts';

export async function runOutlineAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  writingBrief: WritingBrief;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<OutlineRoute> {
  const report = input.onProgress || (() => {});
  report({ stage: 'agent_outline', message: 'Running Outline Agent for writing route' });
  const result = await input.callAgent(
    buildOutlinePrompt(input),
    buildAgentSettings('outline_agent'),
    { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('outline_agent'), onProgress: input.onProgress },
  );
  const text = String(result.body || '').trim();
  if (!text) throw new Error('Outline Agent returned empty route');
  report({ stage: 'agent_outline_done', message: `Outline Agent returned chars=${text.length}` });
  return {
    kind: 'outline_route',
    text,
    openingBeat: extractOutlineSection(text, 'OPENING_BEAT'),
    narrativeThreeBeats: extractOutlineSection(text, 'NARRATIVE_THREE_BEATS'),
    interparagraphTransitions: extractOutlineSection(text, 'INTERPARAGRAPH_TRANSITIONS'),
    chapterClosure: extractOutlineSection(text, 'CHAPTER_CLOSURE'),
  };
}

function extractOutlineSection(text: string, sectionName: string): string {
  const source = String(text || '');
  const start = source.indexOf(`[${sectionName}]`);
  if (start < 0) return '';
  const after = source.slice(start + sectionName.length + 2);
  const next = after.search(/\n\[[A-Z_]+\]\n?/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

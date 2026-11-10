import { buildFactReviewerPrompt } from '../prompts/review/review-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, WritingBrief } from '../../contracts.ts';

export async function runFactReviewer(input: ArticleAgentInput & {
  callAgent: AgentCall;
  writingBrief: WritingBrief;
  body: string;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<string> {
  const result = await input.callAgent(
    buildFactReviewerPrompt(input),
    buildAgentSettings('fact_reviewer'),
    { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('fact_reviewer'), onProgress: input.onProgress },
  );
  return String(result.body || '').trim();
}

import { buildFormatReviewerPrompt } from '../prompts/review/review-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, WritingBrief } from '../../contracts.ts';
import type { StyleViolation } from '../../postprocess/index.ts';

export async function runFormatReviewer(input: ArticleAgentInput & {
  callAgent: AgentCall;
  writingBrief: WritingBrief;
  body: string;
  styleSummary?: Record<string, number>;
  deterministicStyleHits: string;
  styleViolations?: StyleViolation[];
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<string> {
  const result = await input.callAgent(
    buildFormatReviewerPrompt(input),
    buildAgentSettings('format_reviewer'),
    { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('format_reviewer'), onProgress: input.onProgress },
  );
  return String(result.body || '').trim();
}

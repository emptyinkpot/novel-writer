import { buildStyleReviewerPrompt } from '../prompts/review/review-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, WritingBrief } from '../../contracts.ts';
import type { StyleViolation } from '../../postprocess/index.ts';

export async function runAiResidueReviewer(input: ArticleAgentInput & {
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
    buildStyleReviewerPrompt(input),
    buildAgentSettings('style_reviewer'),
    { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('style_reviewer'), onProgress: input.onProgress },
  );
  return String(result.body || '').trim();
}

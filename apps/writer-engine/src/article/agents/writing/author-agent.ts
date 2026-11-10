import { buildAuthorAgentPrompt } from '../prompts/writing/author-prompt.mjs';
import { buildAgentSettings } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, OutlineRoute, WritingBrief } from '../../contracts.ts';
import type { WriterResult } from '../../tools/llm/writer-model.ts';

export async function runAuthorAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  basePrompt: string;
  materialSections: Record<string, string>;
  writingBrief: WritingBrief;
  outlineRoute: OutlineRoute;
  settings?: Record<string, unknown>;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<WriterResult> {
  const report = input.onProgress || (() => {});
  report({ stage: 'writer', message: 'Calling article writer' });
  return input.callAgent(
    buildAuthorAgentPrompt({
      basePrompt: input.basePrompt,
      materialSections: input.materialSections,
      writingBrief: input.writingBrief,
      outlineRoute: input.outlineRoute,
      targetWordCount: input.targetWordCount,
      request: input.request,
      topic: input.topic,
    }),
    {
      ...buildAgentSettings('author_agent'),
      ...(input.settings || {}),
    },
    { signal: input.signal, onProgress: input.onProgress },
  );
}

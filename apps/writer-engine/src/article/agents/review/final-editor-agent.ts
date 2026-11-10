import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import { buildFinalEditorPrompt } from '../prompts/review/final-editor-prompt.mjs';
import type { AgentCall, ArticleAgentInput, ReviewReport, WritingBrief } from '../../contracts.ts';
import { measureArticleLength, resolveLengthWindow, type LengthWindow } from '../../runtime/length-window.ts';
import { evaluateLength, normalizeForMeasure } from '../../runtime/length-policy.ts';
import { runRetryingAgent } from '../../runtime/retrying-agent.ts';

export async function runFinalEditorAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  writingBrief: WritingBrief;
  reviewReport?: ReviewReport;
  body: string;
  supplementalMaterials?: string;
  contextSections?: Record<string, unknown>;
  chapterDiagnostics?: string;
  independentAssessment?: string;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<string> {
  const report = input.onProgress || (() => {});
  const lengthWindow = resolveLengthWindow(input.targetWordCount);
  const inputEffectiveLength = measureArticleLength(input.body);
  report({ stage: 'agent_final_editor', message: `Running Final Editor Agent effectiveLength=${inputEffectiveLength} window=${lengthWindow.minChars}-${lengthWindow.maxChars}` });
  const revised = await runRetryingAgent({
    label: 'agent_final_editor',
    maxAttempts: 3,
    attempt: async (retryFeedback) => {
      const result = await input.callAgent(
        buildFinalEditorPrompt({ ...input, lengthWindow, retryFeedback }),
        buildAgentSettings('final_editor_agent', { maxTokens: 20000 }),
        { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('final_editor_agent'), onProgress: input.onProgress },
      );
      return normalizeBody(result.body);
    },
    validate: (output) => validateFinalEditBody(output, lengthWindow),
    buildFeedback: (lastError) => `你上一次的终稿不合格：${lastError}。本次必须修正：保持连续散文，有效汉字数严格落在 ${lengthWindow.minChars}-${lengthWindow.maxChars} 之间（尤其不得低于 ${lengthWindow.minChars}），不要输出 JSON/标题/项目符号。`,
    report,
  });
  report({ stage: 'agent_final_editor_done', message: `Final Editor Agent returned revisedChars=${revised.length} effectiveLength=${measureArticleLength(revised)}` });
  return revised;
}

function normalizeBody(text: unknown): string {
  const source = String(text || '').trim();
  const match = source.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : source).trim();
}

function validateFinalEditBody(revised: string, lengthWindow: LengthWindow): void {
  if (!revised) throw new Error('Final Editor Agent returned empty body');
  const evaluation = evaluateLength(revised, lengthWindow, 'final_editor');
  if (!evaluation.ok) {
    throw new Error(`Final Editor Agent length out of window: ${evaluation.reason}`);
  }
  const prose = normalizeForMeasure(revised);
  if (/^\s*[{[]/.test(prose)) {
    throw new Error('Final Editor Agent returned structured data instead of prose');
  }
  if (/^#{1,6}\s|\n#{1,6}\s|^\s*[-*]\s+/m.test(prose)) {
    throw new Error('Final Editor Agent returned Markdown/list formatting instead of continuous prose');
  }
}

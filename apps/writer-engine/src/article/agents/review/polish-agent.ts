import { buildRevisionPrompt } from '../prompts/review/review-prompts.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, ReviewReport, WritingBrief } from '../../contracts.ts';
import { measureArticleLength, resolveLengthWindow, type LengthWindow } from '../../runtime/length-window.ts';
import { evaluateLength, normalizeForMeasure } from '../../runtime/length-policy.ts';
import { runRetryingAgent } from '../../runtime/retrying-agent.ts';

export async function runRevisionAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  writingBrief: WritingBrief;
  reviewReport: ReviewReport;
  body: string;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<string> {
  const report = input.onProgress || (() => {});
  const lengthWindow = resolveLengthWindow(input.targetWordCount);
  const inputEffectiveLength = measureArticleLength(input.body);
  report({ stage: 'agent_revision', message: `Running Revision Agent effectiveLength=${inputEffectiveLength} window=${lengthWindow.minChars}-${lengthWindow.maxChars}` });
  const revised = await runRetryingAgent({
    label: 'agent_revision',
    maxAttempts: 3,
    attempt: async (retryFeedback) => {
      const reviewReport = retryFeedback
        ? withRevisionFeedback(input.reviewReport, retryFeedback)
        : input.reviewReport;
      const result = await input.callAgent(
        buildRevisionPrompt({ ...input, reviewReport, lengthWindow, inputEffectiveLength }),
        buildAgentSettings('revision_agent', { maxTokens: 16000 }),
        { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('revision_agent'), onProgress: input.onProgress },
      );
      return normalizeRevisionBody(result.body);
    },
    validate: (output) => validateRevisionBody(input.body, output, lengthWindow),
    buildFeedback: (lastError) => `上一轮修订稿不合格：${lastError}。本次必须修正：保持连续散文，有效汉字数严格落在 ${lengthWindow.minChars}-${lengthWindow.maxChars} 之间（尤其不得低于 ${lengthWindow.minChars}），从原文 DRAFT 恢复被过度压缩的事实链与承接，不新增事实，不输出 JSON/标题/项目符号。`,
    report,
  });
  report({ stage: 'agent_revision_done', message: `Revision Agent returned revisedChars=${revised.length} effectiveLength=${measureArticleLength(revised)}` });
  return revised;
}

function withRevisionFeedback(report: ReviewReport, note: string): ReviewReport {
  return {
    ...report,
    text: [report.text, '', '[REVISION_RETRY_FEEDBACK]', note].join('\n'),
    deterministicStyleHits: [report.deterministicStyleHits || '', '', '[REVISION_RETRY_FEEDBACK]', note].join('\n').trim(),
  };
}

function normalizeRevisionBody(text: unknown): string {
  const source = String(text || '').trim();
  const match = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : source).trim();
}

function validateRevisionBody(original: string, revised: string, lengthWindow: LengthWindow): void {
  if (!revised) throw new Error('Revision Agent returned empty revised body');
  const evaluation = evaluateLength(revised, lengthWindow, 'revision');
  if (!evaluation.ok) {
    throw new Error(`Revision Agent length out of window: ${evaluation.reason}`);
  }
  const prose = normalizeForMeasure(revised);
  if (/^\s*[{[]/.test(prose)) {
    throw new Error('Revision Agent returned structured data instead of revised prose');
  }
  if (/^#{1,6}\s|\n#{1,6}\s|^\s*[-*]\s+/m.test(prose)) {
    throw new Error('Revision Agent returned Markdown/list formatting instead of continuous prose');
  }
  const beforeRepeated = collectRepeatedSentenceKeys(original);
  const afterRepeated = collectRepeatedSentenceKeys(revised);
  if (hasNewRepeatedSentence(beforeRepeated, afterRepeated)) {
    throw new Error('Revision Agent introduced new repeated long sentences');
  }
}

function collectRepeatedSentenceKeys(text: string): Set<string> {
  const counts = new Map<string, number>();
  for (const sentence of splitSentences(text)) {
    const key = normalizeSentenceKey(sentence);
    if (!key || key.length < 24) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
}

function hasNewRepeatedSentence(before: Set<string>, after: Set<string>): boolean {
  for (const key of after) {
    if (!before.has(key)) return true;
  }
  return false;
}

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSentenceKey(sentence: string): string {
  return String(sentence || '')
    .replace(/\s+/g, '')
    .replace(/[，,；;：“”"‘’'（）()《》、·]/g, '')
    .trim();
}

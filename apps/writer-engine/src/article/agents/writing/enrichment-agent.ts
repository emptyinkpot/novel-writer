import { buildEnrichmentPrompt } from '../prompts/writing/enrichment-prompt.mjs';
import { buildAgentSettings, getArticleAgentSystemPrompt } from '../agent-config.ts';
import type { AgentCall, ArticleAgentInput, OutlineRoute, WritingBrief } from '../../contracts.ts';

export async function runEnrichmentAgent(input: ArticleAgentInput & {
  callAgent: AgentCall;
  writingBrief: WritingBrief;
  outlineRoute: OutlineRoute;
  body: string;
  minChars: number;
  maxChars: number;
  currentEffectiveChars?: number;
  neededEffectiveChars?: number;
  targetEffectiveChars?: number;
  maxAddedEffectiveChars?: number;
  currentRawChars?: number;
  targetRawChars?: number;
  maxAddedRawChars?: number;
  factBoundary?: string;
  supplementalMaterials?: string;
  retryFeedback?: string;
  signal?: AbortSignal;
  onProgress?: (event: { stage: string; message: string }) => void;
}): Promise<string> {
  const report = input.onProgress || (() => {});
  report({ stage: 'agent_enrichment', message: `Running Enrichment Agent for in-article material supplementation effective=${input.currentEffectiveChars || 'unknown'} target=${input.targetEffectiveChars || 'unknown'} need=${input.neededEffectiveChars || 'unknown'} maxAdd=${input.maxAddedEffectiveChars || 'unknown'} raw=${input.currentRawChars || 'unknown'} rawTarget=${input.targetRawChars || 'unknown'} rawMaxAdd=${input.maxAddedRawChars || 'unknown'} supplemental=${input.supplementalMaterials?.length || 0}` });
  const result = await input.callAgent(
    buildEnrichmentPrompt(input),
    buildAgentSettings('enrichment_agent', { maxTokens: Math.max(8000, Math.ceil(input.maxChars * 1.8)) }),
    { signal: input.signal, systemPrompt: getArticleAgentSystemPrompt('enrichment_agent'), onProgress: input.onProgress },
  );
  const patchText = String(result.body || '').trim();
  if (!patchText) throw new Error('Enrichment Agent returned empty insertion patch');
  const enriched = applyEnrichmentInsertions(input.body, patchText, input.maxAddedRawChars);
  report({ stage: 'agent_enrichment_done', message: `Enrichment Agent returned patchChars=${patchText.length} revisedChars=${enriched.length}` });
  return enriched;
}

type EnrichmentPatch = {
  insertions?: Array<{
    after?: unknown;
    text?: unknown;
  }>;
};

function applyEnrichmentInsertions(body: string, patchText: string, maxAddedRawChars?: number): string {
  const patch = parseEnrichmentPatch(patchText);
  const insertions = Array.isArray(patch.insertions) ? patch.insertions : [];
  if (!insertions.length) return body;
  const boundedInsertions = insertions.slice(0, 8);
  let revised = body;
  let duplicateBaseline = collectRepeatedSentenceKeys(revised);
  let added = 0;
  let applied = 0;
  const rawLimit = Math.max(300, Number(maxAddedRawChars || 1200));
  for (const insertion of boundedInsertions) {
    const after = normalizeInsertionText(insertion?.after);
    const text = normalizeInsertionText(insertion?.text);
    if (!after || !text) continue;
    if (after.length > 520 || text.length > 960) {
      continue;
    }
    const nextAdded = added + text.length;
    if (nextAdded > rawLimit) {
      continue;
    }
    const candidate = buildInsertionCandidate(revised, after, text, duplicateBaseline);
    if (!candidate) {
      continue;
    }
    const duplicateAfter = collectRepeatedSentenceKeys(candidate);
    added = nextAdded;
    revised = candidate;
    duplicateBaseline = duplicateAfter;
    applied += 1;
  }
  if (applied === 0) {
    throw new Error('Enrichment Agent returned no applicable insertions');
  }
  return revised.trim();
}

function parseEnrichmentPatch(patchText: string): EnrichmentPatch {
  const source = stripCodeFence(patchText);
  try {
    return JSON.parse(source) as EnrichmentPatch;
  } catch (error) {
    throw new Error(`Enrichment Agent returned invalid JSON insertion patch: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stripCodeFence(text: string): string {
  const source = String(text || '').trim();
  const match = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : source).trim();
}

function normalizeInsertionText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildInsertionCandidate(source: string, after: string, text: string, duplicateBaseline: Set<string>): string {
  let offset = 0;
  let sawExactAnchor = false;
  while (true) {
    const index = source.indexOf(after, offset);
    if (index < 0) break;
    sawExactAnchor = true;
    const insertAt = index + after.length;
    if (source.slice(insertAt, insertAt + Math.min(text.length, 80)) === text.slice(0, Math.min(text.length, 80))) {
      offset = insertAt;
      continue;
    }
    const candidate = `${source.slice(0, insertAt)}${text}${source.slice(insertAt)}`;
    const duplicateAfter = collectRepeatedSentenceKeys(candidate);
    if (!hasNewRepeatedSentence(duplicateBaseline, duplicateAfter)) {
      return candidate;
    }
    offset = insertAt;
  }
  if (sawExactAnchor) return '';
  return buildFuzzyParagraphInsertionCandidate(source, after, text, duplicateBaseline);
}

function buildFuzzyParagraphInsertionCandidate(source: string, after: string, text: string, duplicateBaseline: Set<string>): string {
  const paragraphs = source.split(/\n{2,}/);
  const normalizedAnchor = normalizeSentenceKey(after);
  if (normalizedAnchor.length < 18) return '';
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index];
    const score = scoreAnchorOverlap(normalizedAnchor, normalizeSentenceKey(paragraph));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || bestScore < 18) return '';
  const paragraph = paragraphs[bestIndex];
  if (paragraph.includes(text.slice(0, Math.min(text.length, 80)))) return '';
  const nextParagraph = `${paragraph}${text}`;
  const nextParagraphs = [...paragraphs];
  nextParagraphs[bestIndex] = nextParagraph;
  const candidate = nextParagraphs.join('\n\n');
  const duplicateAfter = collectRepeatedSentenceKeys(candidate);
  return hasNewRepeatedSentence(duplicateBaseline, duplicateAfter) ? '' : candidate;
}

function scoreAnchorOverlap(anchor: string, paragraph: string): number {
  if (!anchor || !paragraph) return 0;
  if (paragraph.includes(anchor)) return anchor.length;
  let best = 0;
  for (let start = 0; start < anchor.length; start++) {
    for (let end = start + 18; end <= anchor.length; end++) {
      const fragment = anchor.slice(start, end);
      if (paragraph.includes(fragment) && fragment.length > best) {
        best = fragment.length;
      }
    }
  }
  return best;
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

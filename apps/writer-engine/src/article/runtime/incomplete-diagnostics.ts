import { measureArticleLength } from './length-window.ts';

export type ContinuationDiagnosticsState = {
  lastGeneratedSection?: string;
  lastGeneratedStage?: string;
};

export function buildIncompleteArticleDiagnostics(body: unknown, continuationState: ContinuationDiagnosticsState = {}) {
  const text = String(body || '').trim();
  const lastGeneratedSection = String(continuationState.lastGeneratedSection || '').trim();
  return {
    kind: 'incomplete_article',
    reasons: explainArticleEndingFailures(text),
    effectiveLength: measureArticleLength(text),
    bodyTail: text.slice(-2400),
    terminalParagraphs: splitParagraphs(text).slice(-5),
    lastGeneratedStage: continuationState.lastGeneratedStage || '',
    lastGeneratedSection,
    lastGeneratedTail: lastGeneratedSection.slice(-1600),
  };
}

function explainArticleEndingFailures(body: unknown) {
  const text = String(body || '').trim();
  const tail = text.slice(-80);
  const reasons = [];
  if (!text) reasons.push('empty_body');
  if (/[，、：；,;:]$/.test(tail)) reasons.push('terminal_punctuation_open');
  if (/(因为|由于|如果|当|在|从|把|被|使|让|以及|和|与|而|但|却|并且|然后|最后|例如|比如)$/.test(tail)) reasons.push('terminal_connector_open');
  if (!/[。！？.!?」』”’》]$/.test(tail)) reasons.push('missing_terminal_sentence_punctuation');
  return reasons;
}

function splitParagraphs(text: unknown): string[] {
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

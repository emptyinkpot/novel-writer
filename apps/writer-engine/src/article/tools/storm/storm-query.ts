import { dedupeStrings, splitTerms } from '../../planning/text-utils.ts';

// STORM produces conversational research questions. Search needs keyword-like
// queries, so this keeps the perspective while stripping prompt-like phrasing.
export function stormQuestionsToKeywordQueries(questions: Array<{ question?: string }>): string[] {
  let cut: (text: string) => string[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jieba = require('jieba-wasm');
    cut = (text: string) => jieba.cut(text, true) as string[];
  } catch {
    cut = (text: string) => splitTerms(text);
  }
  const queries = (questions || []).map((entry) => {
    const text = String(entry?.question || '').trim();
    if (!text) return '';
    const tokens = Array.from(new Set(
      cut(text).map((token) => token.trim()).filter((token) => token.length >= 2),
    ));
    return tokens.join(' ').trim();
  });
  return dedupeStrings(queries);
}

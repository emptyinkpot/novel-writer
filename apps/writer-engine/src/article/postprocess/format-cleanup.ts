import type { StylePattern } from './types.ts';

export const STRUCTURAL_HEADING_LINE_PATTERNS: StylePattern[] = [
  { rule: 'format_markdown_heading', pattern: /^\s*#{1,6}\s+\S.*$/gm, category: 'format_structure', severity: 'high', advice: '删除标题行，把必要信息融入相邻自然段。' },
  { rule: 'format_chinese_section_heading', pattern: /^\s*(?:[一二三四五六七八九十百]+|第[一二三四五六七八九十百0-9]+[章节节]?)[、.．：:\s]+.{0,40}$/gm, category: 'format_structure', severity: 'high', advice: '删除章节号，直接用新事实主体开段。' },
  { rule: 'format_numeric_section_heading', pattern: /^\s*[0-9]{1,2}[、.．：:\s]+.{0,40}$/gm, category: 'format_structure', severity: 'high', advice: '删除数字小标题，保持连续散文。' },
  { rule: 'format_internal_planning_label', pattern: /^\s*\[?(?:ARTICLE_SPINE|THESIS_CONTRACT|STRUCTURE|EPISODE_PLAN|FORMAT_CONTRACT|AUTHOR_PROMPT|MATERIAL_AGENT_BRIEF)\]?\s*$/gim, category: 'format_structure', severity: 'high', advice: '内部规划标签不得进入正文。' },
];

export function preserveEntityNames(text: string): string {
  return text;
}

export function breakUniformParagraphs(text: string): string {
  const paragraphs = text.split('\n\n');
  const avgLen = paragraphs.reduce((s, p) => s + p.length, 0) / paragraphs.length;
  const rebuilt: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (p.length > avgLen * 0.8 && p.length < avgLen * 1.2 && i % 4 === 2) {
      const sentences = p.split(/(?<=[。！？])/);
      if (sentences.length >= 4) {
        const mid = Math.floor(sentences.length / 3);
        rebuilt.push(sentences.slice(0, mid).join(''));
        rebuilt.push(sentences.slice(mid).join(''));
        continue;
      }
    }
    rebuilt.push(p);
  }
  return rebuilt.join('\n\n');
}

export function cleanupBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function dedupeRepeatedParagraphs(text: string): { result: string; removed: string[] } {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  const removed: string[] = [];
  for (const paragraph of paragraphs) {
    const key = normalizeComparableParagraph(paragraph);
    if (key.length >= 80 && seen.has(key)) {
      removed.push(paragraph);
      continue;
    }
    if (key.length >= 80) seen.add(key);
    kept.push(paragraph);
  }
  return { result: kept.join('\n\n'), removed };
}

export function stripStructuralHeadingLines(text: string): { result: string; removed: string[] } {
  const removed: string[] = [];
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    for (const { pattern } of STRUCTURAL_HEADING_LINE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        removed.push(trimmed.slice(0, 120));
        return false;
      }
    }
    return true;
  });
  return { result: kept.join('\n'), removed };
}

export function normalizeDislikedPunctuation(text: string): { result: string; changed: number } {
  let changed = 0;
  const result = text.split(/\r?\n/).map((line) => {
    if (shouldSkipPunctuationNormalization(line)) return line;
    let next = line.replace(/：/g, () => {
      changed++;
      return '。';
    });
    next = next.replace(/——|—/g, () => {
      changed++;
      return '，';
    });
    return next;
  }).join('\n');
  return { result, changed };
}

export function normalizeParentheticalAnnotations(text: string): { result: string; changed: number } {
  let changed = 0;
  let result = String(text || '');

  result = result.replace(/([\u4e00-\u9fa5A-Za-z0-9·《》“”]{2,30}(?:战争|战役|革命|法案|条约|会议|事件|事变|运动|时期|时代|政权|体系|秩序|目的|手段|理论|机构|组织|公司|平台|港口|海峡|地区|国家|殖民地|保护国))（([^）\n]{1,40})）/g, (_match, label: string, inner: string) => {
    changed++;
    return renderParentheticalInline(label, inner);
  });

  result = result.replace(/([\u4e00-\u9fa5A-Za-z0-9·《》“”]{2,30}(?:战争|战役|革命|法案|条约|会议|事件|事变|运动|时期|时代|政权|体系|秩序|目的|手段|理论|机构|组织|公司|平台|港口|海峡|地区|国家|殖民地|保护国))\(([^)\n]{1,40})\)/g, (_match, label: string, inner: string) => {
    changed++;
    return renderParentheticalInline(label, inner);
  });

  result = result.replace(/（([^）\n]{1,40})）/g, (_match, inner: string) => {
    changed++;
    return renderLooseParenthetical(inner);
  });
  result = result.replace(/\(([^)\n]{1,40})\)/g, (_match, inner: string) => {
    changed++;
    return renderLooseParenthetical(inner);
  });

  result = result
    .replace(/，([一二三四五六七八九十〇零\d]{2,}[^，。！？\n]{0,24}年)，([是为将把在])/g, '，$1$2')
    .replace(/，，+/g, '，')
    .replace(/，([。！？])/g, '$1')
    .replace(/([。！？])，/g, '$1');

  return { result, changed };
}

function normalizeComparableParagraph(text: unknown): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[，,。！？!?；;：:]/g, '')
    .trim();
}

function renderParentheticalInline(label: string, inner: string): string {
  const labelText = String(label || '').trim();
  const normalized = normalizeParentheticalContent(inner);
  if (!normalized) return labelText;
  const leadingJoin = labelText.match(/^([与和及同])(.+)$/);
  if (leadingJoin) {
    const [, joiner, rest] = leadingJoin;
    return `${joiner}${renderParentheticalInline(rest, normalized)}`;
  }
  if (isYearLikeParenthetical(normalized)) return `${normalized}的${labelText}`;
  if (/[目的手段理论]$/.test(labelText)) return `${normalized}的${labelText}`;
  if (/^(?:即|也就是|也称|又称|简称|英文|英语|日文|原文)/.test(normalized)) {
    return `${stripParentheticalLead(normalized)}这一${labelText}`;
  }
  return `${normalized}这一${labelText}`;
}

function renderLooseParenthetical(inner: string): string {
  const normalized = normalizeParentheticalContent(inner);
  if (!normalized) return '';
  if (/^(?:即|也就是|也称|又称|简称|英文|英语|日文|原文)/.test(normalized)) {
    return `，也就是${stripParentheticalLead(normalized)}，`;
  }
  return `，${normalized}，`;
}

function normalizeParentheticalContent(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripParentheticalLead(value: string): string {
  return String(value || '').replace(/^(?:即|也就是|也称|又称|简称|英文|英语|日文|原文)[:：\s]*/, '').trim();
}

function isYearLikeParenthetical(value: string): boolean {
  return /(?:年|世纪|年代|[0-9]{3,4}|[一二三四五六七八九十〇零]{3,})/.test(value);
}

function shouldSkipPunctuationNormalization(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('<!--') || trimmed.startsWith('#') || trimmed.startsWith('- ')) return true;
  if (/https?:\/\//.test(trimmed)) return true;
  if (/[0-9]{1,2}：[0-9]{2}/.test(trimmed)) return true;
  return false;
}

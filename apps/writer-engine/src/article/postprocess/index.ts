// 后处理门面：编排格式清理、风格传感器和风格画像。
// 具体实现分拆在同目录下；这里是 postprocess 阶段的唯一入口。
import {
  breakUniformParagraphs,
  cleanupBlankLines,
  dedupeRepeatedParagraphs,
  normalizeDislikedPunctuation,
  normalizeParentheticalAnnotations,
  preserveEntityNames,
  stripStructuralHeadingLines,
} from './format-cleanup.ts';
import { buildStyleProfile } from './style-profile.ts';
import { findStyleViolations, summarizeStyleViolations } from './style-sensors.ts';
import type { PostProcessOptions, StyleProfile, StyleViolation } from './types.ts';

export type { PostProcessOptions, StyleProfile, StyleViolation } from './types.ts';
export {
  breakUniformParagraphs,
  buildStyleProfile,
  cleanupBlankLines,
  dedupeRepeatedParagraphs,
  findStyleViolations,
  normalizeDislikedPunctuation,
  normalizeParentheticalAnnotations,
  preserveEntityNames,
  stripStructuralHeadingLines,
  summarizeStyleViolations,
};

export function applyPostProcessing(text: string, options?: PostProcessOptions): { result: string; log: string[]; styleViolations: StyleViolation[]; styleProfile: StyleProfile } {
  const log: string[] = [];
  let result = preserveEntityNames(text);
  if (options?.stripStructuralHeadings !== false) {
    const stripped = stripStructuralHeadingLines(result);
    result = stripped.result;
    if (stripped.removed.length) {
      log.push(`structural headings removed=${stripped.removed.length}`);
    }
  }
  if (options?.dedupeRepeatedParagraphs !== false) {
    const deduped = dedupeRepeatedParagraphs(result);
    result = deduped.result;
    if (deduped.removed.length) {
      log.push(`duplicate paragraphs removed=${deduped.removed.length}`);
    }
  }
  if (options?.breakUniformParagraphs !== false) {
    result = breakUniformParagraphs(result);
  }
  const parenthetical = normalizeParentheticalAnnotations(result);
  result = parenthetical.result;
  if (parenthetical.changed) {
    log.push(`parenthetical annotations normalized=${parenthetical.changed}`);
  }
  if (options?.normalizeDislikedPunctuation === true) {
    const normalized = normalizeDislikedPunctuation(result);
    result = normalized.result;
    if (normalized.changed) {
      log.push(`disliked punctuation normalized=${normalized.changed}`);
    }
  }
  result = cleanupBlankLines(result);
  const styleViolations = findStyleViolations(result);
  const styleProfile = buildStyleProfile(result, styleViolations);
  if (styleViolations.length) {
    log.push(`style violations=${styleViolations.length}`);
  }
  log.push(`style profile aiResidueScore=${styleProfile.aiResidueScore} connectiveDensity=${styleProfile.connectiveDensityPerThousand}/k sentenceStdDev=${styleProfile.sentenceLengthStdDev} openingAnchor=${styleProfile.openingHasConcreteAnchor} concreteAnchorParagraphRatio=${styleProfile.concreteAnchorParagraphRatio}`);
  return { result, log, styleViolations, styleProfile };
}

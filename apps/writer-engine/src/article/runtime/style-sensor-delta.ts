import { summarizeStyleViolations, type StyleViolation } from '../postprocess/index.ts';

export type StyleSensorDelta = {
  enabled: boolean;
  beforeTotal: number;
  afterTotal: number;
  beforeRepairable: number;
  afterRepairable: number;
  reducedTotal: number;
  reducedRepairable: number;
  totalReductionRatio: number;
  repairableReductionRatio: number;
  beforeSummary: Record<string, number>;
  afterSummary: Record<string, number>;
  verdict: 'effective' | 'partial' | 'unchanged' | 'regressed' | 'skipped';
};

export function buildStyleSensorDelta(before: StyleViolation[], after: StyleViolation[], enabled: boolean): StyleSensorDelta {
  const beforeTotal = before.length;
  const afterTotal = after.length;
  const beforeRepairable = before.filter((item) => isCleanupCandidate(item.rule)).length;
  const afterRepairable = after.filter((item) => isCleanupCandidate(item.rule)).length;
  const reducedTotal = beforeTotal - afterTotal;
  const reducedRepairable = beforeRepairable - afterRepairable;
  const totalReductionRatio = beforeTotal > 0 ? roundRatio(reducedTotal / beforeTotal) : 0;
  const repairableReductionRatio = beforeRepairable > 0 ? roundRatio(reducedRepairable / beforeRepairable) : 0;
  return {
    enabled,
    beforeTotal,
    afterTotal,
    beforeRepairable,
    afterRepairable,
    reducedTotal,
    reducedRepairable,
    totalReductionRatio,
    repairableReductionRatio,
    beforeSummary: summarizeStyleViolations(before),
    afterSummary: summarizeStyleViolations(after),
    verdict: resolveSensorDeltaVerdict({ enabled, beforeRepairable, afterRepairable, reducedRepairable }),
  };
}

function isCleanupCandidate(rule: string): boolean {
  return [
    'punctuation_colon_explanatory',
    'punctuation_dash_insert',
    'translationese_bei_suo',
    'translationese_jinxing',
    'translationese_zuowei_yige',
    'translationese_dang_shihou',
    'translationese_zhiyi',
    'translationese_budebu',
    'translationese_yuyi_jiyu',
    'contrastive_negation_bushi_ershi',
    'contrastive_negation_zhebushi_zheshi',
    'contrastive_negation_wentibuzaiyu',
    'contrastive_negation_zhenzhengde',
    'contrastive_negation_biaomian_shiji',
    'contrastive_negation_yuqishuo',
    'contrastive_negation_ruguoshuo',
    'ending_repeated_sentence_loop',
    'ending_repeated_motif_loop',
    'format_markdown_heading',
    'format_chinese_section_heading',
    'format_numeric_section_heading',
    'format_internal_planning_label',
  ].includes(rule);
}

function resolveSensorDeltaVerdict(input: { enabled: boolean; beforeRepairable: number; afterRepairable: number; reducedRepairable: number }): StyleSensorDelta['verdict'] {
  if (!input.enabled && input.beforeRepairable === 0) return 'skipped';
  if (input.reducedRepairable < 0) return 'regressed';
  if (input.beforeRepairable > 0 && input.afterRepairable === 0) return 'effective';
  if (input.reducedRepairable > 0) return 'partial';
  return 'unchanged';
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type { StyleRevisionMetrics } from '../../contracts.ts';
import type { StyleViolation } from '../../postprocess/index.ts';

const CONTRASTIVE_RULES = new Set([
  'contrastive_negation_bushi_ershi',
  'contrastive_negation_zhebushi_zheshi',
  'contrastive_negation_wentibuzaiyu',
  'contrastive_negation_zhenzhengde',
  'contrastive_negation_biaomian_shiji',
  'contrastive_negation_yuqishuo',
  'contrastive_negation_ruguoshuo',
  'mechanical_dualism_ouran_biran',
]);

const TRANSLATIONESE_RULES = new Set([
  'translationese_bei_suo',
  'translationese_jinxing',
  'translationese_zuowei_yige',
  'translationese_dang_shihou',
  'translationese_zhiyi',
  'translationese_budebu',
  'translationese_yuyi_jiyu',
]);

const LECTURE_MARKER_RULES = new Set([
  'ai_connective_zhuanzhe',
  'ai_connective_yushici',
  'ai_connective_pinglunqiang',
  'ai_connective_shoucu',
  'ai_connective_taoyu',
]);

const PUNCTUATION_STYLE_RULES = new Set([
  'punctuation_colon_explanatory',
  'punctuation_dash_insert',
]);

export function formatDeterministicStyleHits(violations: StyleViolation[], maxItems = 80): string {
  const importantRules = new Set([
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
    'ai_connective_zhuanzhe',
    'ai_connective_yushici',
    'ai_connective_pinglunqiang',
    'ai_connective_shoucu',
    'ai_connective_taoyu',
    'ai_rhythm_single_sentence_para',
    'abstract_synthesis_kanjian',
    'abstract_synthesis_mingyun',
    'abstract_synthesis_benzhi',
    'abstract_synthesis_wufa_jiejue',
    'abstract_subject_paragraph',
    'abstract_balanced_parallelism',
    'ending_repeated_sentence_loop',
    'ending_repeated_motif_loop',
    'opening_missing_concrete_anchor',
    'opening_abstract_subject',
  ]);
  const picked = violations
    .filter((item) => importantRules.has(item.rule))
    .slice(0, maxItems);
  if (!picked.length) return '无。';
  return picked.map((item, index) => {
    const match = String(item.match || '').replace(/\s+/g, ' ').trim();
    const advice = String(item.advice || '').replace(/\s+/g, ' ').trim();
    return `${index + 1}. rule=${item.rule} severity=${item.severity || 'low'}\n原句：${match}\n处理：${advice}`;
  }).join('\n\n');
}

export function summarizeStyleRevisionMetrics(violations: StyleViolation[]): StyleRevisionMetrics {
  const topRules: Record<string, number> = {};
  let binaryPatternCount = 0;
  let translationeseCount = 0;
  let lectureMarkerCount = 0;
  let punctuationStyleCount = 0;
  let repairableStyleCount = 0;
  for (const item of violations || []) {
    topRules[item.rule] = (topRules[item.rule] || 0) + 1;
    if (CONTRASTIVE_RULES.has(item.rule)) {
      binaryPatternCount += 1;
      repairableStyleCount += 1;
    }
    if (TRANSLATIONESE_RULES.has(item.rule)) {
      translationeseCount += 1;
      repairableStyleCount += 1;
    }
    if (LECTURE_MARKER_RULES.has(item.rule)) {
      lectureMarkerCount += 1;
      repairableStyleCount += 1;
    }
    if (PUNCTUATION_STYLE_RULES.has(item.rule)) {
      punctuationStyleCount += 1;
      repairableStyleCount += 1;
    }
  }
  return {
    totalStyleViolations: (violations || []).length,
    binaryPatternCount,
    translationeseCount,
    lectureMarkerCount,
    punctuationStyleCount,
    repairableStyleCount,
    topRules,
  };
}

export function formatChineseSyntaxRevisionPlan(violations: StyleViolation[], maxItems = 80): string {
  const candidates = (violations || [])
    .filter((item) => CONTRASTIVE_RULES.has(item.rule) || TRANSLATIONESE_RULES.has(item.rule) || PUNCTUATION_STYLE_RULES.has(item.rule))
    .slice(0, maxItems);
  if (!candidates.length) {
    return '无高置信中文语序修订候选。';
  }
  const lines = [
    '中文语序修订候选只供 Style Reviewer 规划、Revision Agent 局部 patch；不是 postprocess 替换表。',
    '处理分类只能从四类中选：保留、顺写、变体、删除/并入。',
    '顺写优先：把原句读回“主体 -> 动作 -> 后果/判断”的中文顺序；少换词，不新增事实。',
    '变体只用于确实需要对照的句子；不要把“不是……而是……”机械换成“并非……而是……”。',
    '',
  ];
  for (const [index, item] of candidates.entries()) {
    const match = String(item.match || '').replace(/\s+/g, ' ').trim();
    const category = CONTRASTIVE_RULES.has(item.rule)
      ? '二分对照'
      : TRANSLATIONESE_RULES.has(item.rule)
        ? '欧化语序'
        : '标点解释腔';
    lines.push(`${index + 1}. category=${category} rule=${item.rule} severity=${item.severity || 'low'}\n原句：${match}\n计划：先判断是否承载事实；能顺写就顺写，必要时保留或低频变体，空泛总结则删除/并入。`);
  }
  return lines.join('\n');
}

export function formatMandatoryRevisionDocket(violations: StyleViolation[], maxItems = 120): string {
  const candidates = (violations || [])
    .filter((item) => CONTRASTIVE_RULES.has(item.rule) || TRANSLATIONESE_RULES.has(item.rule) || LECTURE_MARKER_RULES.has(item.rule) || PUNCTUATION_STYLE_RULES.has(item.rule))
    .slice(0, maxItems);
  if (!candidates.length) return '';
  const lines = [
    '[MANDATORY_REVISION_DOCKET]',
    '以下是写作后必须逐条处置的局部修订任务，不是正则替换表。',
    'Revision Agent 必须消费每条任务：能顺写则顺写，空泛重复则删除/并入，确属必要对照或事实引文才保留。',
    '保留不是默认选项；保留只适用于真实必要对照、原文引语、书名标题或删改会破坏事实判断的句子。',
    '不得把二分句换皮成“并非……而是……”“表面上……真正……”“问题不在……而在……”。',
    '',
  ];
  for (const [index, item] of candidates.entries()) {
    const match = String(item.match || '').replace(/\s+/g, ' ').trim();
    const advice = String(item.advice || '').replace(/\s+/g, ' ').trim();
    const kind = CONTRASTIVE_RULES.has(item.rule)
      ? '二分/反题'
      : TRANSLATIONESE_RULES.has(item.rule)
        ? '欧化语序'
        : LECTURE_MARKER_RULES.has(item.rule)
          ? '讲课路标'
          : '标点解释腔';
    lines.push(`${index + 1}. kind=${kind} rule=${item.rule} severity=${item.severity || 'low'}\n原句：${match}\n处置义务：${advice || '改成自然中文的主体、动作、后果顺序；不能通顺改写时删除或并入相邻句。'}`);
  }
  return lines.join('\n');
}

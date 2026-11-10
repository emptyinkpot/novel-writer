import { STRUCTURAL_HEADING_LINE_PATTERNS } from './format-cleanup.ts';
import type { StylePattern, StyleViolation } from './types.ts';

const CONTRASTIVE_NEGATION_PATTERNS: StylePattern[] = [
  { rule: 'contrastive_negation_bushi_ershi', pattern: /不是[^。！？\n]{0,60}(?:而是|是)[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'medium', advice: '不要同义替换“不是/而是”，改成事实主体先出场，再写制度动作和后果。' },
  { rule: 'contrastive_negation_zhebushi_zheshi', pattern: /这不是[^。！？\n]{0,60}这是[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'medium', advice: '删除判题式转折，把判断压进相邻事实的落差。' },
  { rule: 'contrastive_negation_wentibuzaiyu', pattern: /问题不在于[^。！？\n]{0,80}而在于[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'high', advice: '把“问题在于”拆成可核查的制度动作、利益流向或具体代价。' },
  { rule: 'contrastive_negation_zhenzhengde', pattern: /真正的?问题不是[^。！？\n]{0,80}而是[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'high', advice: '避免裁判式总结，改由材料本身推出判断。' },
  { rule: 'contrastive_negation_biaomian_shiji', pattern: /表面上是[^。！？\n]{0,80}实际上是[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'medium', advice: '用两个相邻事实段呈现表层和底层，不保留公式化转折。' },
  { rule: 'contrastive_negation_yuqishuo', pattern: /与其说[^。！？\n]{0,80}不如说[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'medium', advice: '改成正向判断句，保留更有事实支撑的一侧。' },
  { rule: 'contrastive_negation_ruguoshuo', pattern: /如果说[^。！？\n]{0,80}那么[^。！？\n]{0,80}/g, category: 'mechanical_contrast', severity: 'low', advice: '只在真实条件推理时保留；否则改成直接叙述。' },
  { rule: 'mechanical_dualism_ouran_biran', pattern: /偶然性[^。！？\n]{0,40}(?:决定|是)[^。！？\n]{0,80}必然性[^。！？\n]{0,40}(?:决定|是)[^。！？\n]{0,80}/g, category: 'abstract_dualism', severity: 'high', advice: '把抽象对偶降解为事件、文件、财政、军队或命名变化。' },
];

const UNSOURCED_METAPHOR_PATTERNS: StylePattern[] = [
  { rule: 'unsourced_metaphor_crack', pattern: /裂缝|裂痕|第一道裂/g, category: 'unsourced_metaphor', severity: 'medium', advice: '如果上下文没有给出该物象链，改用具体制度动作。' },
  { rule: 'unsourced_metaphor_explosive', pattern: /定时炸弹|引爆装置|火药桶/g, category: 'unsourced_metaphor', severity: 'medium', advice: '用财政、军队、边境、舆论或行政动作替代通用危险隐喻。' },
  { rule: 'unsourced_metaphor_building_cliche', pattern: /整栋楼|楼塌了|大厦将倾/g, category: 'unsourced_metaphor', severity: 'medium', advice: '删除建筑式套喻，回到材料里的具体承压机制。' },
  { rule: 'unsourced_metaphor_generic_key', pattern: /打开[^。！？\n]{0,20}钥匙|最后一根稻草/g, category: 'unsourced_metaphor', severity: 'low', advice: '避免万能钥匙/稻草类套话，改成具体触发条件。' },
];

const TRANSLATIONESE_PATTERNS: StylePattern[] = [
  { rule: 'translationese_bei_suo', pattern: /被[^。！？\n]{0,20}所[^。！？\n]{0,12}/g, category: 'translationese', severity: 'medium', advice: '优先改成主动句，让执行主体出场。' },
  { rule: 'translationese_jinxing', pattern: /(?:对|对于)[^。！？\n]{2,20}进行了?[^。！？\n]{0,12}/g, category: 'translationese', severity: 'medium', advice: '把“进行了”改成具体动词，但必须按原句事实选择动词。' },
  { rule: 'translationese_zuowei_yige', pattern: /作为一[个名种位项][^。！？\n]{0,20}/g, category: 'translationese', severity: 'low', advice: '删除身份垫片，直接写主体及其动作。' },
  { rule: 'translationese_dang_shihou', pattern: /当[^。！？\n]{2,30}的?时候/g, category: 'translationese', severity: 'low', advice: '能改成时间状语就改，不能机械删除。' },
  { rule: 'translationese_zhiyi', pattern: /[^。！？\n]{2,24}之一[，,。]/g, category: 'translationese', severity: 'low', advice: '只有确有比较集合时保留，否则改成具体定位。' },
  { rule: 'translationese_budebu', pattern: /不得不[^。！？\n]{0,15}/g, category: 'translationese', severity: 'low', advice: '确认是否真的存在约束压力；没有就改成直接动作。' },
  { rule: 'translationese_yuyi_jiyu', pattern: /(?:予以|给予)[^。！？\n]{0,12}/g, category: 'translationese', severity: 'medium', advice: '改成具体行政动作、财政动作或组织动作。' },
];

const AI_CONNECTIVE_PATTERNS: StylePattern[] = [
  { rule: 'ai_connective_zhuanzhe', pattern: /(?:然而|但是|不过|此外|尽管如此)[，,]/g, category: 'ai_connective', severity: 'low', advice: '连接词可少量保留；密集出现时用事实主体换段。' },
  { rule: 'ai_connective_yushici', pattern: /与此同时|不仅如此|换句话说/g, category: 'ai_connective', severity: 'low', advice: '如果只是缝合段落，删除后改用新事实开头。' },
  { rule: 'ai_connective_pinglunqiang', pattern: /值得(?:注意|一提|关注)的是|可以说|在某种(?:程度|意义)上/g, category: 'ai_commentary', severity: 'medium', advice: '删除教师式提示，把注意点直接写成事实或判断。' },
  { rule: 'ai_connective_shoucu', pattern: /总而言之|综上所述|总的来说/g, category: 'ai_commentary', severity: 'high', advice: '避免课堂总结，结尾停在具体事实或制度判断。' },
  { rule: 'ai_connective_taoyu', pattern: /显而易见|毋庸置疑|众所周知/g, category: 'ai_commentary', severity: 'high', advice: '删除自证式强调，换成材料证据。' },
];

const PUNCTUATION_STYLE_PATTERNS: StylePattern[] = [
  { rule: 'punctuation_colon_explanatory', pattern: /[^。\n]{2,80}：[^。\n]{2,120}/g, category: 'punctuation_style', severity: 'medium', advice: '把冒号解释腔改成自然句。可先写判断，再另起一句展开事实。不要机械替换 URL、时间、检测元数据或原文引语。' },
  { rule: 'punctuation_dash_insert', pattern: /[^。\n]{2,80}[—-]{1,2}[^。\n]{2,120}/g, category: 'punctuation_style', severity: 'medium', advice: '把破折号插入语拆成自然句，或用逗号/句号承接。不得破坏书名、年份范围和原文引语。' },
];

const PARENTHETICAL_ANNOTATION_PATTERNS: StylePattern[] = [
  { rule: 'parenthetical_annotation_cn', pattern: /（[^）\n]{1,50}）/g, category: 'parenthetical_annotation', severity: 'high', advice: '正文不要保留小括号注释。把年份、术语、译名或背景说明融入自然句；信息无用时删除。' },
  { rule: 'parenthetical_annotation_en', pattern: /\([^)\n]{1,50}\)/g, category: 'parenthetical_annotation', severity: 'high', advice: '正文不要保留英文小括号注释。把括号内信息融入自然句；信息无用时删除。' },
];

export const ABSTRACT_TERMS = [
  '空间秩序',
  '网格',
  '国家性格',
  '美国性格',
  '文明',
  '自由',
  '暴力',
  '秩序',
  '标准',
  '边疆',
  '共同体',
  '现代性',
  '国家能力',
  '制度',
  '权力',
  '身份',
  '命运',
];

export const ABSTRACT_SUBJECT_PATTERN = new RegExp(`^(?:${ABSTRACT_TERMS.map(escapeRegExp).join('|')})(?:的[^。！？]{0,16})?(?:是|在|把|让|使|需要|塑造|改变|意味着|成为|来自|依赖|决定|创造|摧毁)`, 'u');

const SYNTHESIS_CLICHE_PATTERNS: StylePattern[] = [
  { rule: 'abstract_synthesis_kanjian', pattern: /看见[^。！？\n]{0,40}就是看见[^。！？\n]{0,80}/g, category: 'abstract_synthesis', severity: 'high', advice: '结尾不要连续升华。改成一个具体事实、制度判断或未解决困境。' },
  { rule: 'abstract_synthesis_mingyun', pattern: /[^。！？\n]{0,30}(?:就是|成为)[^。！？\n]{0,24}命运[。！？]/g, category: 'abstract_synthesis', severity: 'medium', advice: '命运式收束容易替读者封口，改成可见的制度后果。' },
  { rule: 'abstract_synthesis_benzhi', pattern: /(?:本质|核心|根本)[^。！？\n]{0,50}(?:是|在于|意味着)[^。！？\n]{0,80}/g, category: 'abstract_synthesis', severity: 'medium', advice: '本质句要谨慎。能落回文件、机构、财政、土地或人群代价就落回去。' },
  { rule: 'abstract_synthesis_wufa_jiejue', pattern: /这些矛盾无法[^。！？\n]{0,30}只能[^。！？\n]{0,80}/g, category: 'abstract_synthesis', severity: 'medium', advice: '对称总结句要压回具体机制，不要用整齐句式替代判断。' },
];

export function findStyleViolations(text: string): StyleViolation[] {
  const violations: StyleViolation[] = [];
  for (const group of [CONTRASTIVE_NEGATION_PATTERNS, UNSOURCED_METAPHOR_PATTERNS, TRANSLATIONESE_PATTERNS, AI_CONNECTIVE_PATTERNS, PUNCTUATION_STYLE_PATTERNS, PARENTHETICAL_ANNOTATION_PATTERNS, SYNTHESIS_CLICHE_PATTERNS, STRUCTURAL_HEADING_LINE_PATTERNS]) {
    for (const item of group) {
      const { rule, pattern } = item;
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        violations.push({
          rule,
          pattern: String(pattern),
          match: String(match[0] || '').slice(0, 120),
          category: item.category,
          severity: item.severity,
          advice: item.advice,
        });
      }
    }
  }
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const opening = paragraphs[0] || '';
  if (opening && !hasConcreteAnchor(opening.slice(0, 180))) {
    violations.push({
      rule: 'opening_missing_concrete_anchor',
      pattern: 'structural:opening-without-concrete-anchor',
      match: opening.slice(0, 120),
      category: 'narrative_opening',
      severity: 'medium',
      advice: '开头缺少可见的物、地点、文件、机构、制度动作或承受者。不要按词替换；让开头先进入一个材料里已有的现场或动作。',
    });
  }
  if (opening && ABSTRACT_SUBJECT_PATTERN.test(opening) && !hasConcreteAnchor(opening.slice(0, 180))) {
    violations.push({
      rule: 'opening_abstract_subject',
      pattern: 'structural:opening-abstract-subject',
      match: opening.slice(0, 120),
      category: 'narrative_opening',
      severity: 'medium',
      advice: '开头由抽象概念发动，容易滑成讲义。改由已有事实中的具体主体、文件、地点或制度动作打开。',
    });
  }
  const ending = paragraphs[paragraphs.length - 1] || '';
  if (ending && /[？?]\s*$/.test(ending) && /(?:你|我们|读者|是否|准备好|怎么办|何去何从)/u.test(ending.slice(-80))) {
    violations.push({
      rule: 'ending_direct_address_question',
      pattern: 'structural:ending-direct-address-question',
      match: ending.slice(-120),
      category: 'ending_tone',
      severity: 'high',
      advice: '结尾不要用面向读者的口号式提问封口。改为停在已经展开的事实后果、制度困境或未解决代价上。',
    });
  }
  for (const para of paragraphs) {
    const enders = (para.match(/[。！？]/g) || []).length;
    if (enders <= 1 && para.length <= 40 && para.length >= 4) {
      violations.push({
        rule: 'ai_rhythm_single_sentence_para',
        pattern: 'structural:single-sentence-paragraph',
        match: para.slice(0, 120),
        category: 'rhythm',
        severity: 'medium',
        advice: '不要直接删除短段；判断它是否是空泛金句。空泛则并入前后事实段，具体则可保留。',
      });
    }
    if (ABSTRACT_SUBJECT_PATTERN.test(para) && !hasConcreteAnchor(para.slice(0, 120))) {
      violations.push({
        rule: 'abstract_subject_paragraph',
        pattern: 'structural:abstract-subject-paragraph',
        match: para.slice(0, 120),
        category: 'abstract_drift',
        severity: 'medium',
        advice: '段落不要由抽象词自我推进。改成具体机构、文件、土地、铁路、银行、城市、人群或制度动作开头。',
      });
    }
    const balancedClauses = para.match(/它需要[^。！？]{0,40}。它也需要[^。！？]{0,80}/);
    if (balancedClauses) {
      violations.push({
        rule: 'abstract_balanced_parallelism',
        pattern: 'structural:balanced-parallelism',
        match: balancedClauses[0].slice(0, 120),
        category: 'abstract_drift',
        severity: 'medium',
        advice: '对称排比容易变成论文腔总结。改成具体阶段、主体和后果。',
      });
    }
  }
  for (const item of findRepeatedAbstractTerms(text)) {
    violations.push(item);
  }
  for (const item of findComparisonMatrixDrift(paragraphs)) {
    violations.push(item);
  }
  for (const item of findEndingRepetitionDrift(paragraphs)) {
    violations.push(item);
  }
  return violations;
}

export function summarizeStyleViolations(violations: StyleViolation[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const v of violations) {
    summary[v.rule] = (summary[v.rule] ?? 0) + 1;
  }
  return summary;
}

export function hasConcreteAnchor(text: string): boolean {
  return /[0-9一二三四五六七八九十百千万亿]{2,}|年|月|日|法|法案|国会|政府|总统|法院|铁路|公路|银行|公司|军队|城市|州|县|土地|家庭|工人|居民|移民|学校|边境|条约|文件|预算|贷款|税|美元|英里|英亩/.test(text);
}

function findComparisonMatrixDrift(paragraphs: string[]): StyleViolation[] {
  const violations: StyleViolation[] = [];
  let runStart = 0;
  let lastShape = '';
  for (let i = 0; i <= paragraphs.length; i++) {
    const shape = i < paragraphs.length ? comparisonLeadShape(paragraphs[i]) : '';
    const continues = shape && shape === lastShape;
    if (!continues) {
      const runLength = i - runStart;
      if (lastShape && runLength >= 4) {
        const sample = paragraphs.slice(runStart, Math.min(i, runStart + 4)).map((p) => p.slice(0, 42)).join(' / ');
        violations.push({
          rule: 'comparison_matrix_paragraph_run',
          pattern: `structural:comparison-matrix:${lastShape}`,
          match: sample.slice(0, 160),
          category: 'lecture_tone',
          severity: runLength >= 7 ? 'high' : 'medium',
          advice: '相邻段落以同一比较句式逐项填表，容易滑成讲义。把比较对象压回同一历史过程里的因果、转折、代价和后果，不要逐项列清单。',
        });
      }
      runStart = i;
      lastShape = shape;
    }
  }
  return violations;
}

function findEndingRepetitionDrift(paragraphs: string[]): StyleViolation[] {
  const tail = paragraphs.slice(-4).map((p) => p.trim()).filter((p) => p.length >= 80);
  if (tail.length < 2) return [];
  const violations: StyleViolation[] = [];
  const repeatedSentences = findRepeatedTailSentences(tail);
  if (repeatedSentences.length > 0) {
    violations.push({
      rule: 'ending_repeated_sentence_loop',
      pattern: 'structural:ending-repeated-sentence-loop',
      match: repeatedSentences.slice(0, 2).join(' / ').slice(0, 180),
      category: 'ending_tone',
      severity: 'high',
      advice: '结尾出现近似重复句。保留事实后果最具体的一次，删除或压缩后续回环，不要再补新的抽象升华。',
    });
  }
  const repeatedPhrases = findRepeatedTailPhrases(tail);
  if (repeatedPhrases.length > 0) {
    violations.push({
      rule: 'ending_repeated_motif_loop',
      pattern: 'structural:ending-repeated-motif-loop',
      match: repeatedPhrases.slice(0, 3).join(' / ').slice(0, 180),
      category: 'ending_tone',
      severity: 'medium',
      advice: '结尾反复回收同一母题短语，容易变成套话回环。只保留一次回扣，把最后一句落在具体制度困境或未解决代价上。',
    });
  }
  return violations;
}

function findRepeatedTailSentences(paragraphs: string[]): string[] {
  const sentences = paragraphs
    .flatMap((p) => p.split(/(?<=[。！？])/u).map((s) => s.trim()).filter((s) => s.length >= 28));
  const repeated: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      if (sentenceSimilarity(sentences[i], sentences[j]) >= 0.82) {
        repeated.push(sentences[j]);
      }
    }
  }
  return Array.from(new Set(repeated));
}

function findRepeatedTailPhrases(paragraphs: string[]): string[] {
  const text = paragraphs.join('\n');
  const phrases = new Map<string, number>();
  for (const sentence of text.split(/[。！？\n]/u).map((s) => s.trim()).filter(Boolean)) {
    for (const phrase of sentence.match(/[\u4e00-\u9fa5A-Za-z0-9，、]{12,36}/gu) || []) {
      const normalized = phrase.replace(/[，、]/g, '').trim();
      if (normalized.length < 12) continue;
      phrases.set(normalized, (phrases.get(normalized) || 0) + 1);
    }
  }
  return Array.from(phrases.entries())
    .filter(([, count]) => count >= 2)
    .map(([phrase]) => phrase);
}

function sentenceSimilarity(a: string, b: string): number {
  const left = charSet(a);
  const right = charSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const ch of left) {
    if (right.has(ch)) intersection++;
  }
  return intersection / Math.max(left.size, right.size);
}

function charSet(value: string): Set<string> {
  return new Set(String(value || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').split('').filter(Boolean));
}

function comparisonLeadShape(paragraph: string): string {
  const text = String(paragraph || '').trim();
  if (!text) return '';
  if (/^[^。！？\n]{1,24}的(?:命运|财政|教育|军事|社会结构|地理条件|历史遗产|领导层|制度设计|执行能力|适应能力|牺牲意愿|国家机器|改革|代价|遗产)[，,是]/u.test(text)) {
    return 'possessive-topic-comparison';
  }
  if (/^[^。！？\n]{1,24}(?:是|则是|提供了|展示了)[^。！？\n]{0,28}(?:案例|典型|命运|困境)/u.test(text)) {
    return 'case-label-comparison';
  }
  return '';
}

function findRepeatedAbstractTerms(text: string): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const body = String(text || '');
  const chars = Math.max(body.length, 1);
  for (const term of ABSTRACT_TERMS) {
    const count = (body.match(new RegExp(escapeRegExp(term), 'g')) || []).length;
    const densityPerThousand = count / (chars / 1000);
    if (count >= 12 && densityPerThousand >= 1.2) {
      violations.push({
        rule: 'abstract_term_overuse',
        pattern: `term:${term}`,
        match: `${term} x${count}，约 ${round2(densityPerThousand)}/千字`,
        category: 'abstract_drift',
        severity: densityPerThousand >= 2 ? 'high' : 'medium',
        advice: '高频抽象词会造成概念自转。保留必要母题词，其余改成具体主体、制度动作、地点和承担者。',
      });
    }
  }
  return violations;
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

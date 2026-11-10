// WritingBrief 合成器：确定性拼接事实底稿和上下文合成结果。
// 它不是 LLM，不新增任何材料，只给 Author Agent 一个稳定入口。
import type { DivergenceNotes, FactNotes, MeaningNotes, WebRealityNotes, WritingBrief } from '../contracts.ts';

export function buildWritingBrief(input: {
  factNotes: FactNotes;
  webRealityNotes: WebRealityNotes;
  divergenceNotes: DivergenceNotes;
  meaningNotes: MeaningNotes;
}): WritingBrief {
  const factNotes = input.factNotes.text.trim();
  const webRealityNotes = input.webRealityNotes.text.trim();
  const divergenceNotes = input.divergenceNotes.text.trim();
  const meaningNotes = input.meaningNotes.text.trim();
  const interpretationBrief = buildContextBrief(meaningNotes);
  const styleAnchorBrief = extractSection(meaningNotes, 'STYLE_ANCHOR');
  const openingImageBrief = extractSection(meaningNotes, 'OPENING_IMAGE');
  const transitionPressureBrief = extractSection(meaningNotes, 'TRANSITION_PRESSURE');
  const chapterBoundaryBrief = extractSection(meaningNotes, 'CHAPTER_BOUNDARY');
  return {
    kind: 'writing_brief',
    factNotes,
    webRealityNotes,
    divergenceNotes,
    meaningNotes,
    interpretationBrief,
    styleAnchorBrief,
    openingImageBrief,
    transitionPressureBrief,
    chapterBoundaryBrief,
    text: [ // 保留清晰标签，Author prompt 可以直接引用事实底稿和上下文合成。
      '[FACT_NOTES]',
      factNotes,
      '',
      '[WEB_REALITY]',
      webRealityNotes,
      '',
      '[DIVERGENCE_MATERIAL]',
      divergenceNotes,
      '',
      '[STYLE_ANCHOR]',
      styleAnchorBrief,
      '',
      '[OPENING_IMAGE]',
      openingImageBrief,
      '',
      '[TRANSITION_PRESSURE]',
      transitionPressureBrief,
      '',
      '[CHAPTER_BOUNDARY]',
      chapterBoundaryBrief,
      '',
      '[CONTEXT_BRIEF]',
      interpretationBrief,
      '',
      '[CONTEXT_SYNTHESIS]',
      meaningNotes,
    ].filter(Boolean).join('\n').trim(),
  };
}

function extractSection(text: string, sectionName: string): string {
  const source = String(text || '');
  const start = source.indexOf(`[${sectionName}]`);
  if (start < 0) return '';
  const after = source.slice(start + sectionName.length + 2);
  const next = after.search(/\n\[[A-Z_]+\]\n?/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function buildContextBrief(meaningNotes: string): string {
  const sections = [
    'STYLE_ANCHOR',
    'OPENING_IMAGE',
    'TRANSITION_PRESSURE',
    'CHAPTER_BOUNDARY',
    'MATERIAL_RELATIONS',
    'HEAVY_FACTS',
    'LIGHT_OR_DROP',
    'FACT_BOUNDARY',
    'CENTRAL_QUESTION',
    'FIRST_PRESSURE',
    'DEEP_TENSION',
    'MATERIAL_GRAVITY',
    'MATERIAL_DESK',
    'MATERIAL_GROUPS',
    'FACT_BOUNDARIES',
    'EVIDENCE_ANCHORS',
    'COMPOSITION_MATERIALS',
    'DIVERGENCE_MATERIAL',
    'AESTHETIC_USAGE',
    'ARRANGEMENT_ROUTE',
    'OUTLINE_INPUT',
    'RISK_MATERIAL',
  ]
    .map((sectionName) => {
      const content = extractSection(meaningNotes, sectionName);
      return content ? `[${sectionName}]\n${content}` : '';
    })
    .filter(Boolean);
  return sections.length ? sections.join('\n\n') : buildFallbackContextBrief(meaningNotes);
}

function buildFallbackContextBrief(meaningNotes: string): string {
  return [
    '未检测到结构化上下文合成，Writing Agent 只把下面内容当作材料提示，不当作文章结构或审稿规则。',
    '事实、年份、人物、机构、数字和来源归属仍以 [FACT_NOTES] 和 [REALITY] 为准。',
    '任何文学、场景、名著、概念旁照或作者偏好都只提供写法/气氛/关联，不提供事实。',
    meaningNotes.slice(0, 1200),
  ].join('\n');
}

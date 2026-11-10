// Writer prompt hard-boundary sections.
//
// Planning-stage context synthesis may group materials and note risks, but it
// must not pre-author the article shape. This file intentionally keeps only
// source authority boundaries that protect factual accuracy during drafting.

export function buildSourceAuthoritySection() {
  return [
    '[SOURCE_AUTHORITY]',
    '事实权限：只有 [REALITY] 可以提供史实、年份、人物关系、制度因果、地点和数字。',
    '[LITERARY] 只影响句法、节奏、意象温度和段落呼吸；不得把文学材料里的场景、人物、动作或时代关系写成本文事实。',
    '[SEMANTIC] 只提供概念关系和解释方向；不能提供新增事实。',
    '[AUTHOR] 和 Letta 只提供用户偏好、立场和禁用风格；不能提供事实。',
    '[STRUCTURE]、STORM outline、association expansion 只提供研究路线和问题提示；不能提供正文事实。',
    '精确度跟随证据：当 [REALITY] 已给出某个年份、数字、文献名或人名，正文照实写精确值；当 [REALITY] 没有覆盖到，正文降级为模糊表达。',
    '模糊不是含糊其辞：宁可用一个有据的时段和约数把事实站稳，也不要写一个无据的精确数字。',
  ].join('\n');
}

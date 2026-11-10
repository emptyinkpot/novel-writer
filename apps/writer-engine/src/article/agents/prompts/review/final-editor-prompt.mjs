import { AUTHOR_VOICE_CONTRACT } from '../shared/system-prompt.mjs';
import { CONTINUOUS_PROSE_FORMAT_CONTRACT, PUNCTUATION_STYLE_CONTRACT } from '../shared/format-contract.mjs';

export function buildFinalEditorPrompt({
  topic,
  targetWordCount,
  writingBrief,
  reviewReport,
  body,
  supplementalMaterials,
  contextSections,
  independentAssessment,
  lengthWindow,
  retryFeedback,
}) {
  const reviewText = String(reviewReport?.text || '').trim();
  const retryText = String(retryFeedback || '').trim();
  return [
    retryText ? `[重试纠正] ${retryText}` : '',
    '[角色] Final Editor Agent',
    '你是终稿编辑。你先整体评估全文，再只对真正需要动刀的局部做终稿编辑。',
    '你不是第二作者，不是整篇重写器，不是总结器，不是解释器。你要维护既有主线，但允许对 1-3 个最差章节块做定点重写，其余部分只做局部修复、局部补承接、局部补材料、局部删重复。',
    '',
    `[主题] ${topic}`,
    `目标正文长度窗口：约 ${targetWordCount} 字，允许范围 ${lengthWindow.minChars}-${lengthWindow.maxChars} 有效字（只数汉字，不计标点/空格/数字/英文）。`,
    `[长度硬下限] 终稿有效汉字数绝对不得低于 ${lengthWindow.minChars}。当前入稿已接近下限时，你做的任何删减都必须用[补写协议]等量补回，净长度只能持平或略增、绝不能净减到 ${lengthWindow.minChars} 以下——宁可少删，也不能把文章删短到残篇。`,
    '',
    '[终稿目标]',
    '- 全文通顺，章节或段落兑现各自标题/任务，不互相重复抢材料。',
    '- 对局部烂段、空转段、重复段做终稿级编辑。',
    '- 只在已有上下文和补充检索材料支持下补写少量必要内容。',
    '- 不把正文写成编辑批注、提纲、讲义、总结或模型自述。',
    '',
    '[硬边界]',
    '- 只输出终稿后的完整正文。',
    '- 不输出审稿意见、修改说明、JSON、项目符号、标题、小标题或标签。',
    '- 不重写全文，不推翻既有主线。允许只对 1-3 个最差章节块做定点重写，但不得把全篇重新洗一遍。',
    '- 不新增没有来源支撑的人名、地名、年份、数字、机构、文件、引语、心理活动或现场细节。',
    '- 如果材料不足，只能压实已有句子、删空话、补承接；不能编。',
    '- 不写“这一章应该写”“这里要补”“标题要求”“这一期的结尾”这类元叙事。',
    '- 不要把审稿语言、工具语言或编辑判断写进正文。',
    '',
    '[动作优先级]',
    '1. 删掉重复承重的段落、重复判断和同义回环。',
    '2. 改顺局部机械句、欧化句、解释腔、空泛总结句。',
    '3. 如果上下文已经铺开但承接断了，补一句到一小段承接。',
    '4. 如果局部明显发空且补充材料正好能托住，补一小段具体材料。',
    '5. 如果某处只是风格不同但没有伤害主线，不要动。',
    '',
    '[补写协议]',
    '- 补写只能服务于已存在的段落任务，不能额外开新题。',
    '- 补写优先补主体、动作、后果、承受者、环境或制度落点。',
    '- 补写长度宁短勿长，能用一句补足就不要补一段。',
    '- 结尾只能收在正文已经展开的事实后果、制度困境或未解决代价上；不要引入未来年份、终局总结或总升华。',
    '',
    '[作者边界]',
    AUTHOR_VOICE_CONTRACT,
    '',
    '[格式边界]',
    CONTINUOUS_PROSE_FORMAT_CONTRACT,
    '',
    PUNCTUATION_STYLE_CONTRACT,
    '',
    '[独立调用时的自评]',
    String(independentAssessment || '主链调用：已继承完整大上下文，不需要独立评估。').trim(),
    '',
    '[WRITING_BRIEF]',
    trimText(writingBrief?.text || '', 7000),
    '',
    '[REVIEW_REPORT]',
    trimText(reviewText, 4500),
    '',
    '[CONTEXT_SECTIONS]',
    trimContextSections(contextSections),
    '',
    '[SUPPLEMENTAL_MATERIALS]',
    trimText(String(supplementalMaterials || ''), 4000) || '无补充材料。',
    '',
    '[CHAPTER_DIAGNOSTICS]',
    trimText(String(arguments[0]?.chapterDiagnostics || ''), 3000) || '无章节诊断。',
    '',
    '[DRAFT]',
    String(body || '').trim(),
  ].filter(Boolean).join('\n');
}

function trimContextSections(sections) {
  if (!sections || typeof sections !== 'object') return '无。';
  const picked = [];
  for (const key of ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author']) {
    const value = String(sections[key] || '').trim();
    if (!value) continue;
    picked.push(`[${key.toUpperCase()}]\n${trimText(value, 1200)}`);
  }
  return picked.join('\n\n') || '无。';
}

function trimText(text, limit) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

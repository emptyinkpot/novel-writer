// Author Agent prompt：正文写作的主控入口。
// 写作前只保留事实硬边界、产品硬格式和材料包；结构/AI 味监管后置到 Review。
import { AUTHOR_VOICE_CONTRACT } from '../shared/system-prompt.mjs';
import { CONTINUOUS_PROSE_FORMAT_CONTRACT } from '../shared/format-contract.mjs';

export function buildAuthorAgentPrompt({ basePrompt, materialSections, writingBrief, outlineRoute, targetWordCount, request, topic }) {
  const inheritedPrompt = buildInheritedWriterPrompt(basePrompt, materialSections);
  const userTaskContract = buildUserTaskContract({ topic, request });
  const lengthWindow = resolveLengthWindow(targetWordCount);
  return [
    AUTHOR_VOICE_CONTRACT,
    '',
    '[WRITING_AGENT_CONTRACT]',
    '这是一次完整成文。直接写正文，避开摘要、提纲、审稿意见和规则执行记录的腔调。',
    '你面对的是用户任务和材料包。请一次写出完整正文，不输出内部计划、标签、清单或解释过程。',
    '你只回答一个问题：怎样把探索过程讲出来。你是叙述者，不是提纲解释器；判断要从事实、动作和后果里长出来。',
    '禁止解释文章结构，禁止告诉读者接下来要讲什么，禁止使用“回到……”“下面……”“这里需要……”“值得注意的是”“事实上”“换句话说”“从这个意义上说”“归根结底”这类讲课路标。',
    '不要把“不是……而是……”当作默认句式。只有必须区分两个容易混淆的概念时才少量使用；如果连续段落都需要这种句式，改成具体主体、动作、资源流向和后果来推进。',
    '交稿前在心里自查一次：不要出现完全相同的长句，不要把同一历史链或同一总结句换位置重复写。',
    '写作前不得把上下文合成结果改造成固定章节模板。材料包只提供事实、场景、动作、声部和风险边界。',
    '你必须继承 Meaning Agent 给出的材料关系：正文从事实关系里推进，不提前把答案摆出来再分点证明。',
    '如果 [STYLE_ANCHOR]、[OPENING_IMAGE]、[TRANSITION_PRESSURE]、[CHAPTER_BOUNDARY] 已给出，它们不是评论意见，而是这次成文必须继承的风格锚。后续章节必须向这些锚点靠拢，而不是重新发明自己的讲义腔。',
    '开头必须从具体画面、动作、空间、天气、器物、机构现场或承受者进入，不得抽象起笔。中段必须完成清晰的三拍推进。结尾必须停在事实后果、制度余震或未解决代价上，不得用元叙事总结收束。',
    '',
    '[AUTHOR_AGENT_LENGTH_CONTRACT]',
    `目标正文长度：实义汉字（只数汉字，不计标点、空格、数字、英文字母）约 ${targetWordCount} 个，硬性下限 ${lengthWindow.minChars} 个汉字、上限 ${lengthWindow.maxChars} 个汉字。`,
    '长度只按汉字计数，标点不计入，因此成稿的总字符数会明显高于这个数字。请直接按目标值规划篇幅、宁可略高于目标，绝不能低于汉字下限——低于下限会被判为残篇。',
    '这是写作预算窗口。Author Agent 自行决定材料密度和取舍，提前完成篇幅规划，避免把长度任务推给后置校订，也避免靠重复框架、追加总结或尾部扩写撑长。',
    '',
    userTaskContract,
    '',
    '[MATERIAL_AGENT_BRIEF]',
    '以下是材料阶段对已召回材料的压缩和上下文合成。它不新增事实，不规定文章结构，也不提供审稿规则。',
    'Writing Agent 写正文时必须优先服从 FACT_NOTES 的事实边界。',
    'CONTEXT_BRIEF / CONTEXT_SYNTHESIS 只说明材料关系、材料重心、事实边界和发散素材；不得把其中的标题或分组写成正文结构。',
    'OUTLINE_ROUTE 是探索路线，不是章节名。正文要吸收它的进入方式、问题推进、材料运动和事实边界，而不是照抄标签。',
    '如果 OUTLINE_ROUTE 给出了 [OPENING_BEAT]、[NARRATIVE_THREE_BEATS]、[INTERPARAGRAPH_TRANSITIONS]、[CHAPTER_CLOSURE]，你必须把它们执行成自然正文，而不是把这些标签写出来。',
    '如果材料元数据标出归属限制，正文不得把系列名、合集名、出版社名、总书名、文件名或章节定位写成“指出、认为、提出”的观点主体。',
    '如果材料被列为类比材料、发散材料或弱相关材料，正文只能低频、局部、从属地使用；它不能承担中心论证，不能反复出现，不能放到结尾替文章收束。',
    '引用合集型材料前必须满足两个条件：有具体作者或具体子册/作品名，并且该材料被判为直接证据或支撑旁证。缺任一条件，就写事实本身或舍弃该材料。',
    writingBrief.text,
    '',
    '[OUTLINE_ROUTE]',
    '以下是 Outline Agent 给出的构思提示词。请优先继承其中的材料关系、材料排序、理论使用方式、发散材料使用方式和舍弃建议。',
    '注意：发散材料低频使用不等于正文压缩。事实骨干、制度动作、资源流向、承受者和后果必须按目标长度充分展开。',
    '它只是构思路线，不可照抄为标题、章节或平均三段；要把它转化为自然散文的事实推进和段落呼吸。',
    outlineRoute?.text || '',
    '',
    '[OUTLINE_EXECUTION_ANCHORS]',
    outlineRoute?.openingBeat ? `[OPENING_BEAT]\n${outlineRoute.openingBeat}` : '',
    outlineRoute?.narrativeThreeBeats ? `[NARRATIVE_THREE_BEATS]\n${outlineRoute.narrativeThreeBeats}` : '',
    outlineRoute?.interparagraphTransitions ? `[INTERPARAGRAPH_TRANSITIONS]\n${outlineRoute.interparagraphTransitions}` : '',
    outlineRoute?.chapterClosure ? `[CHAPTER_CLOSURE]\n${outlineRoute.chapterClosure}` : '',
    '',
    CONTINUOUS_PROSE_FORMAT_CONTRACT,
    '',
    '[INHERITED_DYNAMIC_WRITER_PROMPT]',
    '以下是 Context Engine 已经完成召回和装箱后的材料包。它提供材料和事实边界，避免当作审稿清单或必须照抄的结构。',
    'Writing Agent 必须继承其中的事实权限和来源权限；非 Reality 通道只能影响写法、偏好或发散关联，不能提供新增事实。',
    inheritedPrompt,
  ].join('\n');
}

function resolveLengthWindow(targetWordCount) {
  const target = Math.max(1, Math.floor(Number(targetWordCount) || 1));
  const tolerance = Math.min(1000, Math.max(300, Math.floor(target * 0.125)));
  return {
    minChars: Math.max(1, target - tolerance),
    maxChars: target + tolerance,
  };
}

function buildUserTaskContract({ topic, request }) {
  const input = String(request?.input || '').trim();
  const target = String(request?.target || request?.title || '').trim();
  const lines = [
    '[USER_TASK_CONTRACT]',
    `任务主题：${topic || ''}`,
    target && target !== topic ? `任务标题/目标：${target}` : '',
    input ? `用户原始任务：${clipLongText(input, 1800)}` : '',
    '用户原始任务和任务主题决定正文要回答的问题。召回材料和材料合成都必须服务这个问题，不能把相关但偏离主线的材料改造成正文中心。',
    '若用户明确列出主线、写作位置、必须展开的思想工具或对象，只继承语义方向，不把它机械翻译成均匀章节或固定顺序。',
    '用户原始任务里的说明句只提供语义边界，不提供正文句法模板。若其中出现“不是……而是……”“不要……要……”等用来澄清需求的句式，正文必须继承澄清后的方向，不能继承这种二分句法。',
  ].filter(Boolean);
  return lines.join('\n');
}

function clipLongText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}……` : text;
}

function buildInheritedWriterPrompt(basePrompt = '', sections = {}) {
  const inherited = String(basePrompt || '').trim();
  if (inherited) return inherited;

  const sectionText = [
    sections.reality ? `[REALITY]\n${sections.reality}` : '',
    sections.literary ? `[LITERARY]\n${sections.literary}` : '',
    sections.semantic ? `[SEMANTIC]\n${sections.semantic}` : '',
    sections.lexicon ? `[LEXICON]\n${sections.lexicon}` : '',
    sections.structure ? `[STRUCTURE]\n${sections.structure}` : '',
    sections.author ? `[AUTHOR]\n${sections.author}` : '',
  ].filter(Boolean).join('\n\n');
  if (!sectionText.trim()) return '';
  return [
    '[SOURCE_AUTHORITY_FOR_AUTHOR]',
    '[REALITY] 才能提供事实、年份、人物、机构、引文、数字和因果依据。',
    '[LITERARY] 只提供叙述气息、意象温度、材料组织和段落呼吸，不提供本文事实。',
    '[SEMANTIC] 只提供概念关系和解释方向，不提供本文事实。',
    '[AUTHOR] 只提供用户偏好、立场和风格边界，不提供本文事实。',
    '[LEXICON] 只提供偏好词和禁用词边界。',
    '[STRUCTURE] 只提供研究路线、问题提示或收束方向。',
    '',
    sectionText,
  ].join('\n');
}

// 材料阶段 prompt：Fact Agent 管硬事实，Context Synthesizer 管材料合成。
// 这里只拼 prompt，不调用模型；执行入口在 agents/material-agents.ts。
export function buildFactAgentPrompt({ topic, targetWordCount, context, request }) {
  const userTaskContract = buildUserTaskContract({ topic, request });
  return [
    '[角色] Fact Agent',
    '你只负责把已召回材料中的可写事实压缩成事实底稿，不写正文。',
    '你只回答一个问题：有哪些事实值得写。不要回答这些事实说明什么，不要解释历史意义，不要替 Meaning Agent 形成问题或结论。',
    '',
    '[任务]',
    `主题：${topic}`,
    `目标字数：${targetWordCount}`,
    userTaskContract,
    '',
    '从 [REALITY] 和 EvidencePack 里提取：年份、数字、人物、机构、文件、地名、事件、制度动作、可核查因果。',
    '高风险数字、绝对化表达、无法确认的当代延伸，要标成“需降级”。',
    '当前年份、近未来年份、尚未发布的报告、政策预告、技术部署和趋势预测，只有在 [REALITY] 明确给出来源、机构、日期和动作时才能进入“可直接写”。否则一律放入“禁止写”，不得用来补结尾或升华主题。',
    '同时检查来源归属。系列、合集、出版社、文件名、总书名加序章/导论/第几章但没有具体作者或子册信息的材料，只能标为“归属不足”，不得写成观点主体。',
    '如果材料只是跨文明类比、概论性判断或概念旁照，不得放进“可直接写”；最多放入“需谨慎写”，并说明它不能承担主论证。',
    '如果材料标有“任务框架匹配：topic-only-tool-or-background”，说明它命中了主题概念但没有命中用户任务框架；它可以解释工具或背景，但不得进入“可直接写”的骨干事实组。',
    '',
    '[输出格式]',
    '只输出中文短段落，不输出 JSON，不写正文。',
    '按“可直接写 / 需谨慎写 / 禁止写”三组组织。',
    '',
    '[REALITY]',
    readPackedSection(context, 'reality') || formatDiagnosticItems(context, ['reality'], {
      limit: 30,
      factOnly: true,
    }),
    '',
    '[STORM_CANDIDATE_CITATIONS]',
    '以下只作为研究线索。未被 EvidencePack 支撑的内容必须标为“需谨慎写”，不得当成事实权威。',
    context.diagnostics?.items
      ?.filter((item) => String(item.provenance?.sourceSystem || '').toLowerCase() === 'storm' && item.channel === 'reality')
      ?.slice(0, 8)
      ?.map((item, index) => `线索${index + 1}：${item.title || ''}\n来源：${item.source || item.url || ''}\n${compactPreview(item.preview || '')}`)
      ?.join('\n\n') || '',
  ].join('\n');
}

export function buildWebRealityAgentPrompt({ topic, targetWordCount, context, request }) {
  const userTaskContract = buildUserTaskContract({ topic, request });
  return [
    '[角色] Web Reality Agent',
    '你只负责整理已经通过 DataBase/Search 通道进入的当前/公开现实材料，不写正文，不自行联网，不新增材料外事实。',
    '你只回答一个问题：哪些当前/公开现实材料有来源、日期、机构和动作。不要解释它们意味着什么。',
    '',
    '[任务]',
    `主题：${topic}`,
    `目标字数：${targetWordCount}`,
    userTaskContract,
    '',
    '从 [REALITY] 和 STORM reality citation hints 中整理当前性材料、公开机构材料、日期、来源、动作和引用边界。',
    '如果材料没有日期、机构、来源或动作，只能标为“不可承重”。',
    '历史背景、文学参照、概念旁照或结构建议不属于当前现实材料，不要收入本报告。',
    '',
    '[输出格式]',
    '只输出中文短段落，不输出 JSON，不写正文。',
    '按“可承重现实材料 / 需核验现实材料 / 不可承重材料”三组组织。',
    '',
    '[REALITY]',
    readPackedSection(context, 'reality') || formatDiagnosticItems(context, ['reality'], {
      limit: 24,
      factOnly: true,
    }),
    '',
    '[STORM_REALITY_HINTS]',
    context.diagnostics?.items
      ?.filter((item) => String(item.provenance?.sourceSystem || '').toLowerCase() === 'storm' && item.channel === 'reality')
      ?.slice(0, 8)
      ?.map((item, index) => `线索${index + 1}：${item.title || ''}\n来源：${item.source || item.url || ''}\n${compactPreview(item.preview || '')}`)
      ?.join('\n\n') || '',
  ].join('\n');
}

export function buildDivergenceAgentPrompt({ topic, targetWordCount, context, request }) {
  const userTaskContract = buildUserTaskContract({ topic, request });
  return [
    '[角色] Divergence Agent',
    '你是文风与美学材料采集者。你只负责从非 Reality 通道里整理写作前的文风、词汇、比喻、旁照和作者偏好材料，不写正文，不新增事实。',
    '你只回答一个问题：可以怎样观察。不要回答如何论证，不要替 Meaning Agent 定中心问题，不要替 Outline Agent 决定从哪里写起。',
    '',
    '[任务]',
    `主题：${topic}`,
    `目标字数：${targetWordCount}`,
    userTaskContract,
    '',
    '人的构思阶段会先找笔调、词、旁照和可借用的美学材料。你的任务就是把这些材料按种类和质量整理给 Meaning/Outline 使用。',
    '你不负责设计文章视角、剧情、开头场景、抉择压力或情绪弧线；这些如果由你预设，会让文章模板化。',
    '发散材料只能帮助后续 Writing Agent 获得更丰富、更高质量的文风、词汇、结构、旁照和作者偏好材料。',
    '你不得把发散材料写成事实依据，不得建议固定结构，不得提出正文金句、结尾口号或整段可照抄文本。',
    '如果材料只是漂亮但偏题、词味过重、容易喧宾夺主、容易诱发 AI 式对称结构或金句总结，必须标成慎用。',
    '',
    '[输出格式]',
    '只输出中文短段落，不输出 JSON，不写正文。',
    '使用以下标题组织：',
    '[STYLE_RESOURCES] 文风资源：筛选与本文题材相近、气息相合的文风样本或作者偏好，说明质量高在哪里、适合影响文章哪一层。',
    '[AESTHETIC_MATERIALS] 美学材料：文学作品、历史书写方式、意象系统、叙述气息；说明它们能提供什么感觉或写法，不提供事实。',
    '[LEXICON_RESOURCES] 词汇资源：按本文题材筛选可用词、慎用词和禁用倾向；说明词汇质量、使用场合和可能风险，避免整包倾倒词库。',
    '[STRUCTURE_RESOURCES] 结构资源：从 Structure/Author/Semantic 中筛选可借鉴的结构样本、组织方式或材料展开顺序；只说明可借鉴处，不规定正文模板。',
    '[ANALOGY_RESOURCES] 旁照资源：名著、思想家、历史文本或跨域材料只说明能局部旁照什么，不能承重；标明质量和适用位置。',
    '[COMPOSITION_WARNINGS] 构思慎用：漂亮但偏题、过度戏剧化、容易金句化、容易让旁照抢主线、容易导致理论复读的材料。',
    '',
    '[NON_REALITY_CONTEXT]',
    ['literary', 'semantic', 'structure', 'lexicon', 'author'].map((channel) => {
      const packed = readPackedSection(context, channel);
      const fallback = formatDiagnosticItems(context, [channel], { limit: 10 });
      return `[${channel.toUpperCase()}]\n${packed || fallback}`;
    }).join('\n\n'),
  ].join('\n');
}

export function buildMeaningAgentPrompt({ topic, targetWordCount, context, request }) {
  const userTaskContract = buildUserTaskContract({ topic, request });
  return [
    '[角色] Meaning Agent / 材料关系整理者',
    '你不是资料秘书，也不是提纲生成器。你负责从已召回材料中挑出最值得写的事实关系，让后续写作从材料关系里长出来。',
    '你只回答一个问题：哪些事实放在一起最有写作价值。不要形成答案，不要形成观点，不要形成中心问题，不要替 Outline Agent 安排路线。',
    '',
    '[任务]',
    `主题：${topic}`,
    `目标字数：${targetWordCount}`,
    userTaskContract,
    '',
    '先读材料，不急着分类，也不要急着下定义。你要把事实之间的关系摆出来：谁控制谁，谁替代谁，谁拥有权力却没有责任，谁承担责任却没有权力，哪个制度动作改变了资源、边界、军队或身份。',
    '事实边界仍然必须可靠：年份、人物、机构、文件、数字、来源归属和具体因果不能越过 Fact/Web Reality 的支撑。文学、类比、词汇和作者偏好只能影响气息，不能变成事实依据。',
    '不要把材料整理成表，不要输出章节提纲，不要分配段落，不要写正文句子，不要用字段控制后续写作。',
    '如果材料很多，只保留能形成清楚事实关系的部分；相关但只会制造资料陈列、原因清单或理论总结的材料，直接说明应当轻放或不用。',
    '',
    '[输出格式]',
    '只输出中文短段落，不输出 JSON，不写正文。',
    '用少量自然小标题组织，像写给 Outline/Author 的材料备忘，而不是材料表：',
    '[MATERIAL_RELATIONS] 最值得写的事实关系。用“A 控制 B / A 替代 B / A 拥有 B 的权力却没有 B 的责任 / A 与 B 重叠”这类关系句表达，不要写成结论或口号。',
    '[HEAVY_FACTS] 最能承重的事实、制度动作、人物处境、资源流向和后果。',
    '[LIGHT_OR_DROP] 哪些材料虽然相关，但会把文章带回资料陈列、原因清单、理论总结或重复证明。',
    '[FACT_BOUNDARY] 必须守住的事实边界和来源边界。',
    '',
    '[PLANNING_AGENT_OUTPUTS]',
    inputPlanningNotes(request),
    '',
    '[CONTEXT DIGEST]',
    ['reality', 'literary', 'structure', 'semantic', 'lexicon', 'author'].map((channel) => {
      const packed = readPackedSection(context, channel);
      const fallback = formatDiagnosticItems(context, [channel], { limit: 12 });
      return `[${channel.toUpperCase()}]\n${packed || fallback}`;
    }).join('\n\n'),
    '',
    '[STORM_RESEARCH]',
    `status=${context.diagnostics?.storm?.status || 'absent'} required=${context.diagnostics?.storm?.required === true}`,
    context.diagnostics?.items
      ?.filter((item) => String(item.provenance?.sourceSystem || '').toLowerCase() === 'storm')
      ?.slice(0, 12)
      ?.map((item, index) => `STORM${index + 1}｜${item.channel}｜${item.title || ''}\n${compactPreview(item.preview || '')}`)
      ?.join('\n\n') || '',
  ].join('\n');
}

function inputPlanningNotes(request) {
  const notes = request?.__planningAgentNotes;
  if (!notes || typeof notes !== 'object') return '无独立 Planning agent 输出。';
  return [
    '[FACT_AGENT]',
    notes.factNotes || '',
    '',
    '[WEB_REALITY_AGENT]',
    notes.webRealityNotes || '',
    '',
    '[DIVERGENCE_AGENT]',
    notes.divergenceNotes || '',
  ].join('\n').trim();
}

function buildUserTaskContract({ topic, request }) {
  const input = String(request?.input || '').trim();
  const target = String(request?.target || request?.title || '').trim();
  const lines = [
    '[USER_TASK_CONTRACT]',
    `任务主题：${topic}`,
    target && target !== topic ? `任务标题/目标：${target}` : '',
    input ? `用户原始任务：${clipLongText(input, 1800)}` : '',
    '材料承重顺序：用户原始任务和任务主题高于召回材料的自然重心。召回材料只能在服务该任务时承重；相关但偏离主线的材料必须降为旁证、类比或舍弃。',
    '不得把召回材料中篇幅最长、叙事最完整或句子最漂亮的旁支包装成正文中心。',
    '不得把用户任务里的主线变成固定章节模板；只标出哪些材料与任务直接相关，哪些只是背景或发散素材。',
  ].filter(Boolean);
  return lines.join('\n');
}

function clipLongText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}……` : text;
}

function readPackedSection(context, channel) {
  return String(context?.sections?.[channel] || '').trim();
}

function formatDiagnosticItems(context, channels, options = {}) {
  const limit = options.limit || 12;
  const items = context.diagnostics?.items
    ?.filter((item) => channels.includes(item.channel))
    ?.filter((item) => !options.factOnly || (item.channel === 'reality'
      && item.provenance?.originTruth !== 'contentbase.storm.citation_hint'
      && !isNonRealitySource(item)))
    ?.slice(0, limit) || [];
  return items.map((item, index) => {
    const attributionRestricted = item.metadata?.attributionSubjectAllowed === false;
    return [
      `材料${index + 1}：${item.title || ''}`,
      `来源：${item.source || item.url || ''}`,
      !attributionRestricted && item.metadata?.sourceAuthor ? `来源作者：${item.metadata.sourceAuthor}` : '',
      !attributionRestricted && item.metadata?.sourceWorkTitle ? `可归属作品：${item.metadata.sourceWorkTitle}` : '',
      item.metadata?.sourceContainerTitle ? `来源容器：${item.metadata.sourceContainerTitle}` : '',
      attributionRestricted && item.metadata?.sourceAuthor ? `受限来源容器署名：${item.metadata.sourceAuthor}` : '',
      attributionRestricted && item.metadata?.sourceWorkTitle ? `受限来源标题：${item.metadata.sourceWorkTitle}` : '',
      item.metadata?.sourceLocator ? `来源定位：${item.metadata.sourceLocator}` : '',
      attributionRestricted ? `归属限制：不可把该来源标题、容器、系列或章节定位写成观点主体；原因=${item.metadata.attributionSubjectReason || 'insufficient-attribution'}` : '',
      compactPreview(item.preview || ''),
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function compactPreview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const half = Math.floor(text.length / 2);
  if (half >= 80 && text.slice(0, half) === text.slice(half, half * 2)) {
    return text.slice(0, half);
  }
  return text;
}

function isNonRealitySource(item) {
  const source = [
    item?.source,
    item?.url,
    item?.provenance?.sourceId,
    item?.metadata?.sourceId,
    item?.metadata?.provider,
    item?.metadata?.originTruth,
  ].map((value) => String(value || '').toLowerCase()).join('\n');
  return source.includes('semantic__')
    || source.includes('literary__')
    || source.includes('lexicon__')
    || source.includes('contentbase.semantic')
    || source.includes('ragflow.literary');
}

// Article Agent Registry：文章生成 12 个 canonical agent 的唯一注册表。
// 分层用注释表达；所有注册 agent 都必须接入 canonical article runtime。
import type { ArticleToolName } from './tools.ts';

export type ArticleAgentName =
  | 'fact_agent'
  | 'web_reality_agent'
  | 'divergence_agent'
  | 'meaning_agent'
  | 'outline_agent'
  | 'author_agent'
  | 'enrichment_agent'
  | 'format_reviewer'
  | 'fact_reviewer'
  | 'style_reviewer'
  | 'revision_agent'
  | 'final_editor_agent';

export type ArticleAgentStage = 'planning' | 'writing' | 'review';
export type ArticleAgentStatus = 'active';
export type ArticleAgentKind =
  | 'knowledge_corpus'
  | 'web_reality'
  | 'divergence'
  | 'context_synthesizer'
  | 'outline'
  | 'writer'
  | 'enrichment'
  | 'format_reviewer'
  | 'fact_reviewer'
  | 'ai_residue_reviewer'
  | 'polish'
  | 'final_editor';

export type ArticleBodyMutation = 'none' | 'full_body' | 'patch';
export type ArticleFactAuthority = 'reality_only' | 'no_new_facts' | 'review_only';
export type ArticleArtifactName =
  | 'request_normalized'
  | 'knowledge_corpus_pack'
  | 'web_reality_pack'
  | 'divergence_pack'
  | 'context_prompt'
  | 'outline_route'
  | 'draft_body'
  | 'enriched_body'
  | 'format_report'
  | 'fact_report'
  | 'ai_residue_report'
  | 'revision_patch'
  | 'final_edit_patch'
  | 'final_body';

export type ArticleAgentConfig = {
  name: ArticleAgentName;
  canonicalName: string;
  stage: ArticleAgentStage;
  status: ArticleAgentStatus;
  kind: ArticleAgentKind;
  profile: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  bodyMutation: ArticleBodyMutation;
  factAuthority: ArticleFactAuthority;
  trigger: string;
  reads: ArticleArtifactName[];
  writes: ArticleArtifactName;
  tools: ArticleToolName[];
  inputContract: string;
  outputContract: string;
  systemPrompt: string;
  role: string;
  rationale: string;
};

export const ARTICLE_AGENT_REGISTRY: Record<ArticleAgentName, ArticleAgentConfig> = {
  // Planning layer
  fact_agent: {
    name: 'fact_agent',
    canonicalName: 'Knowledge Corpus Agent',
    stage: 'planning',
    status: 'active',
    kind: 'knowledge_corpus',
    profile: 'deepseek',
    temperature: 0.1,
    maxTokens: 2500,
    stream: true,
    bodyMutation: 'none',
    factAuthority: 'reality_only',
    trigger: 'request_normalized',
    reads: ['request_normalized'],
    writes: 'knowledge_corpus_pack',
    tools: ['llm_generation', 'database_gateway', 'ragflow_retrieval', 'storm_research', 'semantic_search', 'source_boundary_checker'],
    inputContract: '读取 Context Engine 已装箱的 Reality/EvidencePack 与请求语义。',
    outputContract: '输出可写事实、风险事实、禁写事实和来源边界，不写正文。',
    systemPrompt: [
      '你是事实底稿助手。',
      '只根据用户提供的材料压缩事实边界，不写正文，不调用工具，不补充材料外知识。',
      '你只回答“有哪些事实值得写”，不回答这些事实说明什么，不解释历史意义。',
    ].join('\n'),
    role: '从 Reality/EvidencePack 中压缩可写事实、风险事实和禁写事实；不解释事实意义。',
    rationale: '生产默认与主 Writer 同走 DeepSeek，避免 profile 漂移；如要用 Claude，必须显式覆盖 CONTENTBASE_AGENT_FACT_AGENT_PROFILE。',
  },
  web_reality_agent: {
    name: 'web_reality_agent',
    canonicalName: 'Web Reality Agent',
    stage: 'planning',
    status: 'active',
    kind: 'web_reality',
    profile: 'deepseek',
    temperature: 0.1,
    maxTokens: 2500,
    stream: false,
    bodyMutation: 'none',
    factAuthority: 'reality_only',
    trigger: 'request_normalized',
    reads: ['request_normalized'],
    writes: 'web_reality_pack',
    tools: ['llm_generation', 'database_gateway', 'web_search', 'source_boundary_checker'],
    inputContract: '读取 DataBase-owned web/search reality material 和已装箱 Reality/STORM 线索。',
    outputContract: '输出带日期、机构、来源和引用边界的现实材料摘录，不写正文。',
    systemPrompt: [
      '你是现实材料助手。',
      '只整理已经通过 DataBase/Search 通道进入的现实材料，不绕过 DataBase 自行检索。',
      '你只回答哪些现实材料有来源、日期、机构和动作，不解释材料意义，不写正文。',
    ].join('\n'),
    role: '规划层的当前/公开现实材料整理者。',
    rationale: '用户规划要求 Planning 中知识库资料、网上资料、发散资料并行；该 agent 只整理已进入 DataBase/Search 通道的现实材料。',
  },
  divergence_agent: {
    name: 'divergence_agent',
    canonicalName: 'Divergence Agent',
    stage: 'planning',
    status: 'active',
    kind: 'divergence',
    profile: 'deepseek',
    temperature: 0.35,
    maxTokens: 3000,
    stream: false,
    bodyMutation: 'none',
    factAuthority: 'no_new_facts',
    trigger: 'request_normalized',
    reads: ['request_normalized'],
    writes: 'divergence_pack',
    tools: ['llm_generation', 'literary_search', 'semantic_search', 'author_profile'],
    inputContract: '读取 Literary/Semantic/Structure/Author 等非 Reality 通道和用户题目。',
    outputContract: '输出文风、美学、词汇、比喻、旁照和慎用资源，不提供事实依据，不写正文。',
    systemPrompt: [
      '你是文风与美学材料采集助手。',
      '只整理文风、美学、词汇、比喻、旁照和作者偏好资源，不写正文，不新增事实。',
      '你只回答可以怎样观察，不回答如何论证，不替后续 agent 定问题、定路线或写句子。',
    ].join('\n'),
    role: '规划层的文风、美学、词汇、旁照和文学材料采集者；只供构思使用，不承担事实和结构。',
    rationale: '发散材料必须在 Writing 前进入上下文，不应在 Review/Postprocess 中变成风格规训。',
  },
  meaning_agent: {
    name: 'meaning_agent',
    canonicalName: 'Material Relation Agent',
    stage: 'planning',
    status: 'active',
    kind: 'context_synthesizer',
    profile: 'deepseek',
    temperature: 0.2,
    maxTokens: 3000,
    stream: false,
    bodyMutation: 'none',
    factAuthority: 'no_new_facts',
    trigger: 'knowledge_corpus_pack + web_reality_pack + divergence_pack',
    reads: ['knowledge_corpus_pack', 'web_reality_pack', 'divergence_pack'],
    writes: 'context_prompt',
    tools: ['llm_generation', 'context_pack', 'source_boundary_checker'],
    inputContract: '读取已召回材料、Fact Agent 输出和非 Reality 辅助材料。',
    outputContract: '输出最值得写的事实关系、承重事实、轻放材料和事实边界，不写章节提纲或结论证明。',
    systemPrompt: [
      '你是材料关系整理助手。',
      '只根据用户提供的材料整理最值得写的事实关系、承重事实、轻放材料和事实边界，不写正文，不新增事实。',
      '你只回答哪些事实放在一起最有写作价值，不形成答案、观点或中心问题，不替 Outline Agent 安排路线。',
    ].join('\n'),
    role: '把事实材料和美学材料收束成可写的事实关系，避免上下文滑成抽象问题、资料清单或结论证明。',
    rationale: '材料关系整理和中文语义收束优先，默认 DeepSeek；它不是资料秘书，也不是预写作结构规划器。',
  },

  // Writing layer
  outline_agent: {
    name: 'outline_agent',
    canonicalName: 'Outline Agent',
    stage: 'writing',
    status: 'active',
    kind: 'outline',
    profile: 'deepseek',
    temperature: 0.25,
    maxTokens: 3000,
    stream: false,
    bodyMutation: 'none',
    factAuthority: 'no_new_facts',
    trigger: 'context_prompt',
    reads: ['request_normalized', 'context_prompt'],
    writes: 'outline_route',
    tools: ['llm_generation', 'context_pack'],
    inputContract: '读取大上下文提示词、用户任务和材料边界。',
    outputContract: '输出给 Author Agent 的构思提示词，说明材料关系、观察入口、事实展开顺序、材料取舍、理论用法和美学材料用法。',
    systemPrompt: [
      '你是构思提示词助手。',
      '只根据上下文材料形成给 Author Agent 使用的写作路线，不写正文，不输出固定章节模板。',
      '你只回答如何探索这个问题，不回答答案是什么，不替 Author Agent 写判断句、金句、开头或结尾。',
    ].join('\n'),
    role: '写作层的构思提示词拟定者；把材料关系、事实材料、美学材料和舍弃边界排成 Author 可执行的写作路线。',
    rationale: '用户规划要求正文前先拟定大纲/路线；当前由 article-flow 在 Writing 阶段调用，并把路线传给 Writing Agent。',
  },
  author_agent: {
    name: 'author_agent',
    canonicalName: 'Writing Agent',
    stage: 'writing',
    status: 'active',
    kind: 'writer',
    profile: 'deepseek',
    temperature: 0.4,
    maxTokens: 24000,
    stream: false,
    bodyMutation: 'full_body',
    factAuthority: 'reality_only',
    trigger: 'outline_route',
    reads: ['request_normalized', 'context_prompt', 'outline_route'],
    writes: 'draft_body',
    tools: ['llm_generation'],
    inputContract: '读取用户任务、Context Engine prompt、material sections 和 writingBrief。',
    outputContract: '一次输出完整正文，不输出提纲、审稿意见、结构标签或解释过程。',
    systemPrompt: '你只回答怎样把探索过程讲出来。你是叙述者，不是提纲解释器；判断要从事实、动作和后果里长出来。',
    role: '一次成文，承担正文声部、叙事密度和长文展开；不把答案提前摆成证明题。',
    rationale: '中文长文生成和语感优先，默认 DeepSeek；maxTokens 会被目标字数动态抬高。',
  },
  enrichment_agent: {
    name: 'enrichment_agent',
    canonicalName: 'Enrichment Agent',
    stage: 'writing',
    status: 'active',
    kind: 'enrichment',
    profile: 'deepseek',
    temperature: 0.25,
    maxTokens: 16000,
    stream: false,
    bodyMutation: 'patch',
    factAuthority: 'no_new_facts',
    trigger: 'draft_body below length window',
    reads: ['draft_body', 'context_prompt'],
    writes: 'enriched_body',
    tools: ['llm_generation', 'database_gateway', 'ragflow_retrieval', 'web_search', 'semantic_search', 'lexicon_lookup', 'source_boundary_checker'],
    inputContract: '读取完整正文、writingBrief、上下文包、长度窗口、事实边界和经 本地语料 去重后的补充材料。',
    outputContract: '输出 JSON insertions，由 runtime 插回原文生成 enriched_body；不输出说明、报告、重复段落或尾部续写。',
    systemPrompt: [
      '你是续写补充材料助手，属于 Writing 层。',
      '你只在完整正文内部均匀补充经 本地语料 支撑且未在正文重复出现的材料，保持语句通顺和上下文承接。',
      '你只回答哪里缺少已有来源支撑的证据，不补观点、补景色、补结构、补结论或替 Author Agent 重新写作。',
    ].join('\n'),
    role: '在完整正文内部均匀补充 本地语料 支撑且未重复的材料，保持语句通顺和上下文承接，不自由编事实、不追加尾巴。',
    rationale: '补充正文是写作行为，必须由 Writing-stage agent 读取补充材料并输出完整通顺正文，不能交给机械 postprocess 或 review 补救。',
  },

  // Post-Writing Review layer
  format_reviewer: {
    name: 'format_reviewer',
    canonicalName: 'Format Review Agent',
    stage: 'review',
    status: 'active',
    kind: 'format_reviewer',
    profile: 'deepseek',
    temperature: 0.1,
    maxTokens: 1500,
    stream: true,
    bodyMutation: 'none',
    factAuthority: 'review_only',
    trigger: 'draft_body or enriched_body',
    reads: ['draft_body', 'enriched_body'],
    writes: 'format_report',
    tools: ['llm_generation', 'format_sensor'],
    inputContract: '读取完整正文和产品格式合同。',
    outputContract: '只输出格式问题报告，不重写正文。',
    systemPrompt: [
      '你是格式审查助手。',
      '只检查连续散文格式、Markdown 泄露、内部标签、列表和标点布局，不审思想，不重写正文。',
      '输出必须是可执行格式问题报告。',
    ].join('\n'),
    role: '写后阶段的产品格式审查者。',
    rationale: '用户规划要求 Format Review 独立于 AI 味审查；它只输出格式报告，不直接修改正文。',
  },
  fact_reviewer: {
    name: 'fact_reviewer',
    canonicalName: 'Fact Reviewer',
    stage: 'review',
    status: 'active',
    kind: 'fact_reviewer',
    profile: 'deepseek',
    temperature: 0.1,
    maxTokens: 2500,
    stream: true,
    bodyMutation: 'none',
    factAuthority: 'review_only',
    trigger: 'draft_body or enriched_body',
    reads: ['draft_body', 'enriched_body', 'knowledge_corpus_pack'],
    writes: 'fact_report',
    tools: ['llm_generation', 'source_boundary_checker'],
    inputContract: '读取 writingBrief/factNotes 和完整草稿。',
    outputContract: '输出事实风险、绝对化表达、因果越界和来源边界审稿意见，不重写正文。',
    systemPrompt: [
      '你是事实审稿助手。',
      '只根据用户提供的事实底稿和草稿审查事实风险，不查新资料，不润色，不重写正文。',
      '你只回答是真的吗，不评价文章写得好不好，不提出风格、结构或文学性意见。',
    ].join('\n'),
    role: '审事实风险、绝对化表达、因果越界和来源边界。',
    rationale: '生产默认与主 Writer 同走 DeepSeek，避免 profile 漂移；如要用 Claude，必须显式覆盖 CONTENTBASE_AGENT_FACT_REVIEWER_PROFILE。',
  },
  style_reviewer: {
    name: 'style_reviewer',
    canonicalName: 'AI-Residue Review Agent',
    stage: 'review',
    status: 'active',
    kind: 'ai_residue_reviewer',
    profile: 'deepseek',
    temperature: 0.1,
    maxTokens: 2500,
    stream: false,
    bodyMutation: 'none',
    factAuthority: 'review_only',
    trigger: 'draft_body or enriched_body',
    reads: ['draft_body', 'enriched_body'],
    writes: 'ai_residue_report',
    tools: ['llm_generation', 'style_sensor', 'format_sensor'],
    inputContract: '读取完整草稿、writingBrief、格式合同和确定性风格传感器结果。',
    outputContract: '输出 AI 味、结构过整、重复框架、二分转折和节奏问题报告，不重写正文。',
    systemPrompt: [
      '你是中文文风审稿助手。',
      '只审结构、句式、AI味、连续散文格式和作者声部，不查新资料，不重写正文。',
      '你只回答哪里像 AI 或结构跑偏，不判断历史观点是否成立，不替 Fact Reviewer 审事实真伪。',
    ].join('\n'),
    role: '审中文文风、AI 味、二分转折、标题结构和节奏问题。',
    rationale: '中文风格判断和句式敏感度优先，默认 DeepSeek。',
  },
  revision_agent: {
    name: 'revision_agent',
    canonicalName: 'Polish Agent',
    stage: 'review',
    status: 'active',
    kind: 'polish',
    profile: 'deepseek',
    temperature: 0.2,
    maxTokens: 12000,
    stream: false,
    bodyMutation: 'patch',
    factAuthority: 'no_new_facts',
    trigger: 'format_report + fact_report + ai_residue_report',
    reads: ['draft_body', 'enriched_body', 'format_report', 'fact_report', 'ai_residue_report'],
    writes: 'revision_patch',
    tools: ['llm_generation', 'lexicon_lookup', 'author_profile', 'source_boundary_checker'],
    inputContract: '读取完整正文、writingBrief、Fact/AI-Residue/Format 审查报告和确定性命中句。',
    outputContract: '输出 JSON patch 局部修订协议，由 runtime 精确应用到原文；不输出完整正文，不新增事实，不重建文章主线。',
    systemPrompt: [
      '你是最终局部修订者。',
      '只根据用户提供的事实底稿、审稿意见和草稿输出最小 JSON patch，不新增事实，不查新资料，不改变作者声部。',
      '你只回答哪些已经被审稿点名的问题能局部修，不重新解释文章，不重构全文。',
      '只处理审稿明确指出的问题：改顺事实主体、动词、承接、格式和少量重复句。',
      '输入正文已经在长度窗口内时，不做全文重写、整体压缩、开头重写、段落重排或大段合并拆分。',
      '只能处理短句级局部问题；需要大段改写、段落重构或补充事实的问题一律不处理。',
      '只输出 {"operations":[{"find":"...","replace":"..."}]}，不要 reason、解释、Markdown 或额外字段；如果没有必须改问题，输出 {"operations":[]}。',
    ].join('\n'),
    role: '按审稿意见输出局部 JSON patch，不新增事实，不改变作者声部，不承担机械补字或全文压缩。',
    rationale: '修订要兼顾中文声部和事实保守，默认 DeepSeek；事实风险由 Fact Reviewer 先兜底。',
  },
  final_editor_agent: {
    name: 'final_editor_agent',
    canonicalName: 'Final Editor Agent',
    stage: 'review',
    status: 'active',
    kind: 'final_editor',
    profile: 'deepseek',
    temperature: 0.2,
    maxTokens: 16000,
    stream: false,
    bodyMutation: 'patch',
    factAuthority: 'no_new_facts',
    trigger: 'revision_patch applied',
    reads: ['draft_body', 'enriched_body', 'format_report', 'fact_report', 'ai_residue_report', 'revision_patch'],
    writes: 'final_edit_patch',
    tools: ['llm_generation', 'database_gateway', 'ragflow_retrieval', 'web_search', 'semantic_search', 'lexicon_lookup', 'author_profile', 'letta_memory', 'source_boundary_checker'],
    inputContract: '读取全文、writingBrief、审稿报告、修订后正文、上下文材料和补充检索材料；主链里继承大上下文，独立调用时先自行评估文本缺口。',
    outputContract: '输出终稿编辑后的完整正文；允许局部润色、补承接、删重复、补充已检索材料支持的小段落，但不重写全文、不新增无来源事实。',
    systemPrompt: [
      '你是终稿编辑，不是重写器。',
      '你先通读全文，再判断哪里需要局部润色、哪里需要补承接、哪里需要删重复、哪里需要在已检索材料支持下补一小段。',
      '你只在局部动刀，不推翻文章主线，不重写全文，不输出说明。',
      '你可以利用给定的大上下文、作者偏好和补充检索材料，但不能新增没有来源支撑的事实。',
      '如果文本已经成立，就只做必要的小改；不要为了显得聪明而到处重写。',
    ].join('\n'),
    role: '在主链最后做一次全文终稿编辑：自评、查缺、补燃料、局部润色和少量补写，保证章节兑现标题、减少重复和空转。',
    rationale: '终稿问题需要全文视野和补充检索能力，不能再靠 revision_agent 的机械局部修订承担。',
  },
};

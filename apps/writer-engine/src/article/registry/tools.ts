// Article Tool Registry：agent 可调用的外部能力/内部模块清单。
// Tool 不是 agent；tool 只提供能力，agent 才拥有产物和判断责任。

export type ArticleToolName =
  | 'llm_generation'
  | 'database_gateway'
  | 'ragflow_retrieval'
  | 'storm_research'
  | 'web_search'
  | 'literary_search'
  | 'semantic_search'
  | 'lexicon_lookup'
  | 'author_profile'
  | 'letta_memory'
  | 'context_pack'
  | 'format_sensor'
  | 'style_sensor'
  | 'source_boundary_checker';

export type ArticleToolKind = 'llm' | 'external_service' | 'corpus_retrieval' | 'context_module' | 'sensor' | 'preference_module';
export type ArticleToolStage = 'planning' | 'writing' | 'review';
export type ArticleToolFactAuthority = 'reality_fact_source' | 'context_only' | 'preference_only' | 'sensor_only';
export type ArticleToolBodyAuthority = 'none' | 'sensor_only';

export type ArticleToolConfig = {
  name: ArticleToolName;
  kind: ArticleToolKind;
  owner: string;
  modulePath: string;
  allowedStages: ArticleToolStage[];
  factAuthority: ArticleToolFactAuthority;
  bodyAuthority: ArticleToolBodyAuthority;
  contract: string;
};

export const ARTICLE_TOOL_REGISTRY: Record<ArticleToolName, ArticleToolConfig> = {
  llm_generation: {
    name: 'llm_generation',
    kind: 'llm',
    owner: 'ContentBase Writer model runtime',
    modulePath: 'src/article/tools/llm/writer-model.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'context_only',
    bodyAuthority: 'none',
    contract: '所有 agent 的基础模型能力；只根据 agent prompt 和已注入上下文产出该 agent 的阶段产物，不自行检索、不绕过 agent-flow。',
  },
  database_gateway: {
    name: 'database_gateway',
    kind: 'external_service',
    owner: 'DataBase Gateway',
    modulePath: 'src/article/tools/database/database-gateway-client.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'reality_fact_source',
    bodyAuthority: 'none',
    contract: 'ContentBase 只能通过 DataBase Gateway 获取 EvidencePack、Corpus、web/search 和 source metadata。Writing 层只允许 enrichment_agent 用它查找补充材料；Review 层只允许 final_editor_agent 用它补充终稿编辑所需材料，不能绕过 agent-flow。',
  },
  ragflow_retrieval: {
    name: 'ragflow_retrieval',
    kind: 'corpus_retrieval',
    owner: 'DataBase Gateway -> RAGFlow',
    modulePath: 'src/article/planning/context-builder.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'context_only',
    bodyAuthority: 'none',
    contract: 'RAGFlow 只作为检索工具进入 ContentBase，不直接成为正文事实 owner；来源必须保留 provenance/citation。Writing 层只允许 enrichment_agent 用于补充材料查缺口；Review 层只允许 final_editor_agent 用于终稿补充写作前的材料查缺口。',
  },
  storm_research: {
    name: 'storm_research',
    kind: 'external_service',
    owner: 'STORM service',
    modulePath: 'src/article/tools/storm/storm-research-engine.ts',
    allowedStages: ['planning'],
    factAuthority: 'context_only',
    bodyAuthority: 'none',
    contract: 'STORM 只提供研究视角、问题、outline 和引用线索，不替代 Reality 事实来源。',
  },
  web_search: {
    name: 'web_search',
    kind: 'external_service',
    owner: 'DataBase-owned search/web channel',
    modulePath: 'src/article/tools/database/database-gateway-client.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'reality_fact_source',
    bodyAuthority: 'none',
    contract: '只提供当前/公开现实材料，必须带日期、机构、来源和引用边界。Writing 层只允许 enrichment_agent 用于补充材料查缺口；Review 层只允许 final_editor_agent 用于终稿编辑前补现实材料。',
  },
  literary_search: {
    name: 'literary_search',
    kind: 'corpus_retrieval',
    owner: 'DataBase literary corpus',
    modulePath: 'src/article/planning/context-builder.ts',
    allowedStages: ['planning'],
    factAuthority: 'context_only',
    bodyAuthority: 'none',
    contract: '只提供文学参照、叙述气息、意象、材料组织和审美储备，不提供本文事实。',
  },
  semantic_search: {
    name: 'semantic_search',
    kind: 'corpus_retrieval',
    owner: 'DataBase semantic corpus',
    modulePath: 'src/article/planning/context-builder.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'context_only',
    bodyAuthority: 'none',
    contract: '只提供概念关系、语义关联和解释方向，不提供本文事实。Writing 层只允许 enrichment_agent 用于发现可补充材料方向；Review 层只允许 final_editor_agent 用于发现终稿补写方向。',
  },
  lexicon_lookup: {
    name: 'lexicon_lookup',
    kind: 'preference_module',
    owner: 'DataBase vocabulary corpus',
    modulePath: 'src/article/planning/context-builder.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'preference_only',
    bodyAuthority: 'none',
    contract: '只提供偏好词、禁用词和局部措辞边界，不承担正文扩写。',
  },
  author_profile: {
    name: 'author_profile',
    kind: 'preference_module',
    owner: 'DataBase/Letta author memory',
    modulePath: 'src/article/planning/context-builder.ts',
    allowedStages: ['planning', 'review'],
    factAuthority: 'preference_only',
    bodyAuthority: 'none',
    contract: '只提供用户长期偏好、作者画像和风格边界，不提供事实。',
  },
  letta_memory: {
    name: 'letta_memory',
    kind: 'preference_module',
    owner: 'Letta memory runtime',
    modulePath: 'src/article/tools/memory/letta-memory.ts',
    allowedStages: ['review'],
    factAuthority: 'preference_only',
    bodyAuthority: 'none',
    contract: '只提供作者长期偏好、写作目标和终稿编辑时的声部校准边界，不提供现实事实。',
  },
  context_pack: {
    name: 'context_pack',
    kind: 'context_module',
    owner: 'ContentBase context modules',
    modulePath: 'src/article/context/',
    allowedStages: ['planning', 'writing'],
    factAuthority: 'context_only',
    bodyAuthority: 'none',
    contract: '负责 dedupe/rank/budget/source authority/context prompt packing，不写正文。',
  },
  format_sensor: {
    name: 'format_sensor',
    kind: 'sensor',
    owner: 'ContentBase postprocess',
    modulePath: 'src/article/postprocess/format-cleanup.ts',
    allowedStages: ['review'],
    factAuthority: 'sensor_only',
    bodyAuthority: 'sensor_only',
    contract: '只检测格式、Markdown、标签、列表和布局问题，不作为主要修文机关。',
  },
  style_sensor: {
    name: 'style_sensor',
    kind: 'sensor',
    owner: 'ContentBase postprocess',
    modulePath: 'src/article/postprocess/style-sensors.ts',
    allowedStages: ['review'],
    factAuthority: 'sensor_only',
    bodyAuthority: 'sensor_only',
    contract: '只检测 AI residue、重复、机械句法和标点风险，不作为正文生成或修复引擎。',
  },
  source_boundary_checker: {
    name: 'source_boundary_checker',
    kind: 'sensor',
    owner: 'ContentBase source authority modules',
    modulePath: 'src/article/context/source-authority.ts',
    allowedStages: ['planning', 'writing', 'review'],
    factAuthority: 'sensor_only',
    bodyAuthority: 'none',
    contract: '只核对来源权限、Reality/非 Reality 边界和事实归属，不扩写新事实。',
  },
};

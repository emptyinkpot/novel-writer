// 产品配置源码：定义上下文预算、检索比例和后处理策略。
// ContentBase 是“偏好风格 + 知识库检索”的通用写作者，题材不设限：不按体裁分支，
// 任何题材都用同一套通用检索/预算/后处理，由自然语言 brief 决定长度，由 Writer 系统提示决定文体。
// 红线：禁止任何“关键词 -> 体裁”的硬编码映射表（如旧 normalizeGenre）回归——它与
// 已删除的“写作者姓名剥离表”同属硬编码表病，机制 > 个例。题材限制本身就是病灶。
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 1000000,
  'gpt-5.5': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5-20250514': 200000,
  'claude-opus-4-7': 200000,
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
};

export const DEFAULT_MODEL_CONTEXT_WINDOW = 128000;
export const CONTEXT_UTILIZATION_RATIO = 0.25;
export const SYSTEM_PROMPT_RESERVE = 3000;
export const OUTPUT_TOKEN_RESERVE = 8000;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 57000;
export const DEFAULT_CONTEXT_CHAR_BUDGET = 50000;
export const DEFAULT_REALITY_LIMIT = 160;
export const DEFAULT_DURABLE_LIMIT = 50;
export const DEFAULT_EVIDENCE_TIMEOUT_MS = readPositiveIntegerEnv('CONTENTBASE_EVIDENCE_TIMEOUT_MS');

export const RAGFLOW_DATASET_IDS = [
  'bdcc99c658f111f18aecb3d695a2553d',
  'eb927cf6550211f1b2958f4a76330bcc',
] as const;

export type RetrievalLimits = {
  reality: number;
  semantic: number;
  lexicon: number;
  literary: number;
  structure: number;
};

// 通用检索上限：所有题材共用一套。题材不再左右各通道取多少，
// 实际命中由主题词 + reranker 决定，配置只给一个平衡的上限。
export const RETRIEVAL_LIMITS: RetrievalLimits = {
  reality: 120,
  semantic: 35,
  lexicon: 50,
  literary: 35,
  structure: 30,
};

// 通用组装预算（百分比，合计 100）：六个语料通道在最终 Writer 提示里占的篇幅比例。
// 题材不再切换预算；事实打底最高，文学次之，其余补足。
export const COMPOSITION_BUDGET_PCT: Record<string, number> = {
  reality: 32,
  literary: 28,
  semantic: 12,
  lexicon: 10,
  structure: 10,
  author: 8,
};

export const CHANNEL_MIN_ITEMS: Record<string, number> = {
  reality: 3,
  literary: 3,
  semantic: 2,
  lexicon: 5,
  structure: 2,
  author: 2,
};

export const RERANKER = {
  DASHSCOPE_EMBEDDING_MODEL: 'text-embedding-v3',
  BATCH_SIZE: 25,
  MAX_TEXT_CHARS: 2048,
  DEFAULT_KEEP_RATIO: 0.65,
  TIMEOUT_MS: 30_000,
  DEFAULT_TOPIC_WEIGHT: 0.6,
  DEFAULT_AUTHOR_WEIGHT: 0.4,
  REALITY_SIMILARITY_MIN: 0.35,
} as const;

export const BANNED_TRANSITIONS = [
  '此外，', '与此同时，', '不仅如此，', '更为重要的是，', '值得注意的是，',
  '尽管如此，', '不可否认的是，', '总而言之，', '综上所述，', '归根结底，',
  '正因如此，', '尤为重要的是，', '需要指出的是，', '需要强调的是，',
  '在此基础上，', '毋庸置疑，', '不言而喻，', '由此可见，',
  '具体而言，', '换言之，', '事实上，', '客观来说，',
  '不可否认，', '尤其值得关注的是，', '不容忽视的是，',
  '说白了，', '说白了。', '不禁让人思考', '引人深思',
  '值得我们注意', '在某种意义上', '在一定程度上', '从某种角度来看',
] as const;

export const TURN_WORDS = ['然而，', '但是，', '不过，', '尽管如此，', '与此同时，'] as const;

function readPositiveIntegerEnv(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

// 通用长度与后处理默认值：长度优先由自然语言 brief 解析的字数意图决定，
// brief 没给则落到这里的单一默认（可被 env 覆盖）。不再有 per-genre 默认字数。
export const DEFAULT_TARGET_WORD_COUNT = readPositiveIntegerEnv('CONTENTBASE_DEFAULT_TARGET_WORD_COUNT') ?? 8000;
export const DEFAULT_MAX_TOKENS = readPositiveIntegerEnv('CONTENTBASE_DEFAULT_MAX_TOKENS') ?? 24000;
// 长文默认不打散段落（保留 Writer 自然分段）；这是唯一一处后处理开关，全题材统一。
export const DEFAULT_BREAK_UNIFORM_PARAGRAPHS = false;

// 偏好风格种子：检索“怎么写”的文风范本（Literary 教审美资源不教题材事实）。
// 这里召回作者、作品、史论文体、意象系统和材料组织方式，不用“短句/长句/句式”这类微观写法词做检索目标。
export const DEFAULT_STYLE_QUERIES = [
  '鲁迅 杂文 现实诊断',
  '三岛由纪夫 金阁寺 描写',
  '内藤湖南 东洋史 概论',
  '石黑一雄 日の名残り 叙述',
  '北一辉 日本改造法案 政治判断',
  '安德森 想象的共同体 分析',
  '白鸟库吉 东洋史 解释',
  '桑原骘藏 东洋史 史论',
  '宫崎市定 大唐帝国 历史散文',
  '太宰治 人间失格 独白',
  '坂口安吾 堕落论 随笔',
  '川端康成 雪国 描写',
  '夏目漱石 心 叙述',
  '讲谈社 兴亡的世界史 历史叙述',
  '岩波书店 日本近代史 分析',
  '余英时 中国文化 学术散文',
  '历史散文 意象 材料组织',
  '叙事 场景 感官细节 白描',
  '史论散文 制度 材料展开',
] as const;

// 资料收集种子：用于扩大非 Reality 语料池的材料种类。
// 它们只决定检索什么材料，不决定正文怎么写。
export const DEFAULT_MATERIAL_DISCOVERY_QUERIES = [
  '历史叙述 史料组织',
  '制度史 材料展开',
  '地缘政治 历史解释',
  '战争史 后果 制度化',
  '海洋史 航道 港口',
  '国家机器 财政 军队',
  '东亚近代史 史论',
  '历史写作 证据链',
] as const;

export const RANDOM_DISCOVERY_SEEDS = [
  '历史散文 意象', '历史 判断', '制度 描写', '冷淡 精确', '材料组织',
  '港口 航道 海关', '财政 军队 铁路', '条约 租界 赔款',
] as const;

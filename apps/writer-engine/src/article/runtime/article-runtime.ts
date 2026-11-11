// 文章运行时源码：业务壳，负责请求归一、上下文构建、调用 article-flow、结果投影。
// 你可以把这个文件理解成 C 语言里的“业务主函数文件”：
//   HTTP 路由把请求交进来；
//   generateArticle() 归一化请求并构建上下文；
//   article-flow.ts 负责 11-agent 拓扑、长度窗口和写后审查。
// 这里不直接读 DataBase Gateway / LLM 的具体配置，外部服务细节由 src/config/env.ts 和 article 子模块封装。
// 工厂函数：创建“文章运行时对象”。
// 外部不是直接调用本文件里的内部 generateArticle()，而是先创建 articleRuntime，
// 再调用 articleRuntime.generateArticle(input)。
import { buildFinalEditorPrompt } from '../agents/prompts/review/final-editor-prompt.mjs';
import { buildPolishPrompt } from '../agents/prompts/review/polish-prompt.mjs';
import { buildArticleContextEngine } from '../planning/context-builder.ts';
import type { ContextEngineResult } from '../planning/types.ts';
import { RAGFLOW_DATASET_IDS, DEFAULT_EVIDENCE_TIMEOUT_MS } from '../config.ts';
import { LocalCorpus } from '../tools/corpus/local-corpus.ts';
import { callSingleWriter } from '../tools/llm/writer-model.ts';
import type { WriterResult } from '../tools/llm/writer-model.ts';
import type { PostProcessOptions, StyleProfile, StyleViolation } from '../postprocess/index.ts';
import { applyPostProcessing, summarizeStyleViolations } from '../postprocess/index.ts';
import { runArticleAgentFlow, runArticleMaterialStage } from './article-flow.ts';
import type { AgentTrace, ReviewReport } from '../contracts.ts';
import type { ArticleFlowPostProcess } from './article-flow.ts';

export type ArticleProgressEvent = {
  stage: string;
  message: string;
  at: string;
};

export type ArticleRuntimeOptions = {
  signal?: AbortSignal;
  onProgress?: (event: ArticleProgressEvent) => void;
};

type ArticleRequest = Record<string, unknown>;
type ArticleSettings = Record<string, unknown>;

type NormalizedArticleInput = {
  input: string;
  topic: string;
  request: ArticleRequest;
};

type ArticleRuntimeDeps = {
  buildArticleContextEngine: (input: {
    request: ArticleRequest;
    topic: string;
    targetWordCount: number;
    onProgress?: (event: { stage: string; message: string; at?: string }) => void;
  }) => Promise<ContextEngineResult>;
  callSingleWriter: (
    prompt: string,
    settings?: ArticleSettings,
    options?: { signal?: AbortSignal; systemPrompt?: string; onProgress?: (event: { stage: string; message: string }) => void },
  ) => Promise<WriterResult>;
  applyPostProcessing: (
    body: string,
    options?: PostProcessOptions & { failOnStyleViolations?: boolean },
  ) => { result: string; log: string[]; styleViolations: StyleViolation[]; styleProfile: StyleProfile };
};

type ArticlePolishDeps = Pick<ArticleRuntimeDeps, 'callSingleWriter' | 'applyPostProcessing'>;

export type ArticleRuntime = {
  generateArticle: (request: unknown, options?: ArticleRuntimeOptions) => Promise<ArticleGenerationResult>;
  collectArticleMaterials: (request: unknown, options?: ArticleRuntimeOptions) => Promise<ArticleMaterialsResult>;
  polishArticle: (request: unknown) => Promise<ArticlePolishResult>;
  finalEditArticle: (request: unknown, options?: ArticleRuntimeOptions) => Promise<ArticleFinalEditResult>;
};

type ArticleGenerationResult = {
  draft: {
    body: string;
    modelInvocation: WriterResult['trace'];
    continuations: number;
    minimumWordCount: number;
    effectiveLength: number;
    patchPlan: CollectionPatchPlan | null;
    postProcess: { log: string[]; styleViolations: StyleViolation[]; summary: Record<string, number>; styleProfile?: StyleProfile; repairEvaluation?: ArticleFlowPostProcess['repairEvaluation'] };
    agentPipeline: AgentTrace;
  };
  context: {
    evidence: { pack: Record<string, unknown> };
    diagnostics: ContextEngineResult['diagnostics'];
    ragflowRecall: RagflowRecallSummary;
  };
  trace: {
    modelInvocation: WriterResult['trace'];
    context: { diagnostics: ContextEngineResult['diagnostics']; ragflowRecall: RagflowRecallSummary };
    postProcess: { log: string[]; styleViolations: StyleViolation[]; summary: Record<string, number>; styleProfile?: StyleProfile; repairEvaluation?: ArticleFlowPostProcess['repairEvaluation'] };
    agentPipeline: AgentTrace;
    ending: ArticleEndingDiagnostics;
  };
};

type ArticleMaterialsResult = {
  topic: string;
  targetWordCount: number;
  materials: {
    factNotes: string;
    webRealityNotes: string;
    divergenceNotes: string;
    meaningNotes: string;
    writingBrief: string;
  };
  context: {
    evidence: { pack: Record<string, unknown> };
    diagnostics: ContextEngineResult['diagnostics'];
    ragflowRecall: RagflowRecallSummary;
    sections: ContextEngineResult['sections'];
  };
  trace: {
    agentPipeline: AgentTrace;
    context: { diagnostics: ContextEngineResult['diagnostics']; ragflowRecall: RagflowRecallSummary };
  };
};

// 结尾闭合诊断（传感器）：无条件算，进 trace，不强制续写也不抛错。
// 暴露“烂尾/半截推论/缺终止标点”给调用方观测，是否处理由调用方决定。
// RAGFlow 召回健康摘要（传感器）：从 context.diagnostics 既有计数派生，不另发探针。
// RAGFlow 经 DataBase Gateway 首先进入 EvidencePack/Reality；literary、lexicon、
// structure、author 等是写作辅助层。semantic 是可选概念层，空值不能单独把整条
// 生成链判成 degraded。
type RagflowRecallSummary = {
  healthy: boolean;
  status: 'ok' | 'degraded' | 'empty';
  query: string;
  recalledUnits: number;
  packedUnits: number;
  channels: Record<string, { recalled: number; packed: number; loaded: boolean }>;
  loadedChannels: string[];
  emptyChannels: string[];
};

type ArticleEndingDiagnostics = {
  closureQuestion: string;
  reasons: string[];
  closed: boolean;
  effectiveLength: number;
  bodyTail: string;
};

type ArticlePolishResult = {
  draft: {
    body: string;
    originalLength: number;
    polishedLength: number;
    changed: boolean;
    modelInvocation: WriterResult['trace'];
  };
};

type ArticleFinalEditResult = {
  draft: {
    body: string;
    originalLength: number;
    finalLength: number;
    changed: boolean;
    modelInvocation: WriterResult['trace'];
  };
  trace: {
    independentAssessment: string;
    supplementalMaterials: string;
    styleAnchor?: string;
    openingImage?: string;
    chapterBoundaries?: string;
  };
};

type CollectionPatchPlan = {
  type: 'markdown_collection_patch';
  operation: string;
  targetAnchor: string;
  insertPosition: string;
  contentRole: string;
  sourcePath: string;
  bodyLength: number;
  body: string;
  rules: string[];
};

// 题材已去除：运行时不再分支体裁，所有文章共用同一套通用默认值。
// 这两个默认值与 src/article/config.ts 读取同一组环境变量(同一真源)，
// 仅在环境变量未配置时回退到字面量；它们是通用预算常量,不是按题材分支的参数表。
const DEFAULT_TARGET_WORD_COUNT = readPositiveInteger(process.env.CONTENTBASE_DEFAULT_TARGET_WORD_COUNT, 8000);
const DEFAULT_MAX_TOKENS = readPositiveInteger(process.env.CONTENTBASE_DEFAULT_MAX_TOKENS, 24000);

export function createArticleRuntime(deps?: Partial<ArticleRuntimeDeps>): ArticleRuntime {
  const runtimeDeps = resolveArticleRuntimeDeps(deps);
  return {
    // 对外暴露的生成方法：src/server.ts 里调用 articleRuntime.generateArticle(input)。
    // 右侧 generateArticle(...) 才是下面定义的内部主流程函数。
    generateArticle: (request: unknown, options?: ArticleRuntimeOptions) => generateArticle(request, runtimeDeps, options),
    // 对外暴露的资料阶段入口：只跑 context-builder + material agents，不进入 outline/author/revision。
    collectArticleMaterials: (request: unknown, options?: ArticleRuntimeOptions) => collectArticleMaterials(request, runtimeDeps, options),
    // 对外暴露的润色方法：只润色已有正文，不走 EvidencePack 检索主链。
    polishArticle: (request: unknown) => polishArticle(request, runtimeDeps),
    // 对外暴露的终稿编辑方法：对已有正文做全文评估、补充检索和局部终稿编辑。
    finalEditArticle: (request: unknown, options?: ArticleRuntimeOptions) => finalEditArticle(request, runtimeDeps, options),
  };
}

function resolveArticleRuntimeDeps(overrides: Partial<ArticleRuntimeDeps> = {}): ArticleRuntimeDeps {
  return {
    buildArticleContextEngine: overrides.buildArticleContextEngine || buildArticleContextEngine,
    callSingleWriter: overrides.callSingleWriter || callSingleWriter,
    applyPostProcessing: overrides.applyPostProcessing || applyPostProcessing,
  };
}

// 单次文章生成主函数。
// 调用者：createArticleRuntime() 返回对象里的 generateArticle 方法。
// 输入：自然语言字符串，或 { input: "..." } 这类对象。
// 输出：正文 draft、EvidencePack、上下文诊断、模型调用 trace。
async function generateArticle(request: unknown, runtime: ArticleRuntimeDeps, options: ArticleRuntimeOptions = {}): Promise<ArticleGenerationResult> {
  // 生成主流程入口。
  // 对照 C 语言看：这里像 generate_article(request)，下面的代码基本就是顺序执行的调用流程。
  const reportProgress = createProgressReporter(options.onProgress);
  throwIfAborted(options.signal);

  // 第 1 步：校验并归一化输入。
  // 允许用户只给自然语言 input；这里会从自然语言里提取 topic，并组装内部 request。
  reportProgress('validate', 'Validating article request');
  const normalizedInput = normalizeNaturalLanguageArticleRequest(request);
  const topic = normalizedInput.topic;

  // 第 2 步：确定生成预算。
  // 题材已去除：长度只从自然语言 brief 解析；brief 未给出长度时回退通用默认值。
  reportProgress('configure', 'Resolving article generation budget');
  const inputStructure = readObject(normalizedInput.request.structure);
  const targetWordCount = readPositiveInteger(
    normalizedInput.request?.wordCount
      ?? inputStructure.targetWordCount
      ?? normalizedInput.request?.targetWordCount
      ?? process.env.CONTENTBASE_DEFAULT_TARGET_WORD_COUNT,
    DEFAULT_TARGET_WORD_COUNT,
  );
  const normalizedRequest = {
    ...normalizedInput.request,
    structure: {
      ...inputStructure,
      targetWordCount,
    },
  };

  // 第 3 步：构建 Writer 上下文。
  // 这是生成前最重的一步：会进入 planning/context-builder.ts，通过 DataBase Gateway 取证据/语料，
  // 再做 association expansion，最后把材料装成 prompt。
  // 如果 Reality 证据不够，这一步会直接失败，不会进入 Writer 硬写。
  reportProgress('context', 'Building article context and retrieving evidence');
  const context = await withTimeout(
    () => runtime.buildArticleContextEngine({
      request: normalizedRequest,
      topic,
      targetWordCount,
      onProgress: (event) => reportProgress(event.stage, event.message),
    }),
    readPositiveInteger(process.env.CONTENTBASE_CONTEXT_TIMEOUT_MS, 300000),
    'context stage timed out while building article evidence',
  );

  throwIfAborted(options.signal);

  const flowResult = await runArticleAgentFlow({
    topic,
    targetWordCount,
    request: normalizedRequest,
    context,
    deps: {
      callSingleWriter: runtime.callSingleWriter,
      applyPostProcessing: runtime.applyPostProcessing,
    },
    signal: options.signal,
    reportProgress,
  });
  const body = flowResult.body;

  // 第 8 步：返回结果。
  // draft.body 是正文；context.evidence.pack 是 EvidencePack；trace 记录模型调用和上下文诊断。
  // 结尾闭合诊断无条件计算并进 trace（传感器）：不强制续写、不抛错，只把烂尾暴露给调用方。
  reportProgress('complete', 'Article generation completed');
  const endingDiagnostics = diagnoseArticleEnding(body, normalizedRequest, topic);
  const ragflowRecall = summarizeRagflowRecall(context.diagnostics);
  reportProgress('ragflow_recall', `RAGFlow recall status=${ragflowRecall.status} units=${ragflowRecall.recalledUnits} packed=${ragflowRecall.packedUnits} channels=${ragflowRecall.loadedChannels.join(',') || 'none'}`);
  return {
    draft: {
      body,
      modelInvocation: flowResult.modelInvocation.trace,
      continuations: flowResult.continuations,
      minimumWordCount: flowResult.minimumWordCount,
      effectiveLength: flowResult.effectiveLength,
      patchPlan: buildCollectionPatchPlan(normalizedRequest, body),
      postProcess: {
        log: flowResult.postProcess.log || [],
        styleViolations: flowResult.postProcess.styleViolations || [],
        summary: summarizeStyleViolations(flowResult.postProcess.styleViolations || []),
        styleProfile: flowResult.postProcess.styleProfile,
        repairEvaluation: flowResult.postProcess.repairEvaluation,
      },
      agentPipeline: flowResult.agentTrace,
    },
    context: {
      evidence: {
        pack: context.evidencePack,
      },
      diagnostics: context.diagnostics,
      ragflowRecall,
    },
    trace: {
      modelInvocation: flowResult.modelInvocation.trace,
      context: {
        diagnostics: context.diagnostics,
        ragflowRecall,
      },
      postProcess: {
        log: flowResult.postProcess.log || [],
        styleViolations: flowResult.postProcess.styleViolations || [],
        summary: summarizeStyleViolations(flowResult.postProcess.styleViolations || []),
        styleProfile: flowResult.postProcess.styleProfile,
        repairEvaluation: flowResult.postProcess.repairEvaluation,
      },
      agentPipeline: flowResult.agentTrace,
      ending: endingDiagnostics,
    },
  };
}

async function collectArticleMaterials(request: unknown, runtime: ArticleRuntimeDeps, options: ArticleRuntimeOptions = {}): Promise<ArticleMaterialsResult> {
  const reportProgress = createProgressReporter(options.onProgress);
  throwIfAborted(options.signal);
  reportProgress('validate', 'Validating article material request');
  const normalizedInput = normalizeNaturalLanguageArticleRequest(request);
  const topic = normalizedInput.topic;
  reportProgress('configure', 'Resolving article material budget');
  const inputStructure = readObject(normalizedInput.request.structure);
  const targetWordCount = readPositiveInteger(
    normalizedInput.request?.wordCount
      ?? inputStructure.targetWordCount
      ?? normalizedInput.request?.targetWordCount
      ?? process.env.CONTENTBASE_DEFAULT_TARGET_WORD_COUNT,
    DEFAULT_TARGET_WORD_COUNT,
  );
  const normalizedRequest = {
    ...normalizedInput.request,
    structure: {
      ...inputStructure,
      targetWordCount,
    },
  };
  reportProgress('context', 'Building article context and retrieving evidence');
  const context = await withTimeout(
    () => runtime.buildArticleContextEngine({
      request: normalizedRequest,
      topic,
      targetWordCount,
      onProgress: (event) => reportProgress(event.stage, event.message),
    }),
    readPositiveInteger(process.env.CONTENTBASE_CONTEXT_TIMEOUT_MS, 300000),
    'context stage timed out while building article evidence',
  );
  throwIfAborted(options.signal);
  const materialStage = await runArticleMaterialStage({
    topic,
    targetWordCount,
    request: normalizedRequest,
    context,
    deps: { callSingleWriter: runtime.callSingleWriter },
    signal: options.signal,
    reportProgress,
  });
  const ragflowRecall = summarizeRagflowRecall(context.diagnostics);
  reportProgress('ragflow_recall', `RAGFlow recall status=${ragflowRecall.status} units=${ragflowRecall.recalledUnits} packed=${ragflowRecall.packedUnits} channels=${ragflowRecall.loadedChannels.join(',') || 'none'}`);
  reportProgress('materials_complete', 'Article material collection completed');
  return {
    topic,
    targetWordCount,
    materials: {
      factNotes: materialStage.factNotes.text,
      webRealityNotes: materialStage.webRealityNotes.text,
      divergenceNotes: materialStage.divergenceNotes.text,
      meaningNotes: materialStage.meaningNotes.text,
      writingBrief: materialStage.writingBrief.text,
    },
    context: {
      evidence: { pack: context.evidencePack },
      diagnostics: context.diagnostics,
      ragflowRecall,
      sections: context.sections,
    },
    trace: {
      agentPipeline: materialStage.agentTrace,
      context: { diagnostics: context.diagnostics, ragflowRecall },
    },
  };
}

// 从 context.diagnostics 既有计数派生 RAGFlow 召回健康摘要（传感器，不另发探针）。
// reality 是事实证据主通道；其它通道是风格、词库、结构和作者偏好辅助层。
// recalled = 检索回来的原始命中数（counts），packed = 进入 Writer prompt 的命中数（packedCounts）。
// healthy 仅作观测信号：核心 Reality 缺失时 status=degraded，召回为空时 status=empty；
// 本函数不抛错、不阻断生成，真正的 Reality 硬要求在 planning/context-builder 里完成。
// 是否处理交给调用方（run.ps1 打印摘要、job result 暴露 metadata）。
function summarizeRagflowRecall(diagnostics: ContextEngineResult['diagnostics']): RagflowRecallSummary {
  const ragflowChannels = ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author'];
  const counts = (diagnostics?.counts || {}) as Record<string, number>;
  const packedCounts = (diagnostics?.packedCounts || {}) as Record<string, number>;
  const channels: RagflowRecallSummary['channels'] = {};
  let recalledUnits = 0;
  let packedUnits = 0;
  const loadedChannels: string[] = [];
  const emptyChannels: string[] = [];
  for (const channel of ragflowChannels) {
    const recalled = Number(counts[channel] || 0);
    const packed = Number(packedCounts[channel] || 0);
    const loaded = packed > 0;
    channels[channel] = { recalled, packed, loaded };
    recalledUnits += recalled;
    packedUnits += packed;
    if (loaded) loadedChannels.push(channel);
    else emptyChannels.push(channel);
  }
  const coreRealityLoaded = Number(channels.reality?.packed || 0) > 0;
  const status: RagflowRecallSummary['status'] = packedUnits === 0
    ? 'empty'
    : (coreRealityLoaded ? 'ok' : 'degraded');
  return {
    healthy: packedUnits > 0 && coreRealityLoaded,
    status,
    query: String(diagnostics?.query || ''),
    recalledUnits,
    packedUnits,
    channels,
    loadedChannels,
    emptyChannels,
  };
}

// 外部请求归一化函数。
// 目的：把字符串、{ input }、以及少量兼容字段统一成内部 request。
// 只派生 topic 作为检索/标题/收束的单一真源；不再派生 title/target/goal 别名。
// 后面的生成流程只处理这个统一结构。
function normalizeNaturalLanguageArticleRequest(request: unknown): NormalizedArticleInput {
  // 把外部输入压成统一内部结构。
  // 最理想的外部输入是：
  //   { "input": "请写一篇关于……的长文" }
  // 或直接传字符串。
  // 这里只派生 topic;title/target/goal 曾是 topic 的别名,已收敛删除,下游统一回退到 topic。
  if (typeof request === 'string') {
    const input = request.trim();
    if (!input) {
      throw new Error('natural language input is required');
    }
    const topic = extractArticleTopicFromNaturalInput(input);
    // 从自然语言里解析字数意图；没说长度时为 null，由上层回退默认值。
    const parsedWordCount = extractTargetWordCountFromNaturalInput(input);
    return {
      input,
      topic,
      request: {
        input,
        topic,
        ...(parsedWordCount ? { wordCount: parsedWordCount } : {}),
      },
    };
  }
  const source = isPlainObject(request) ? request : {};
  const input = String(
    source.input
    || source.prompt
    || source.message
    || source.topic
    || source.question
    || '',
  ).trim();
  if (!input) {
    throw new Error('natural language input is required');
  }
  const explicitTopic = String(source.topic || '').trim();
  const topic = explicitTopic || extractArticleTopicFromNaturalInput(input);
  // 从自然语言 input 解析字数意图；显式传了长度字段时以显式值优先。
  const parsedWordCount = extractTargetWordCountFromNaturalInput(input);
  const structure = readObject(source.structure);
  const hasExplicitLength = source.wordCount != null
    || source.targetWordCount != null
    || structure.targetWordCount != null;
  return {
    input,
    topic,
    request: {
      ...source,
      ...(parsedWordCount && !hasExplicitLength ? { wordCount: parsedWordCount } : {}),
      input,
      topic,
    },
  };
}

// 从自然语言 input 里提取短 topic。
// 这是字符串清理，不是 LLM 理解；用于给检索、标题和目标字段一个默认值。
function extractArticleTopicFromNaturalInput(input: unknown): string {
  const text = String(input || '').trim();
  if (!text) return text;
  const normalized = text.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '');
  const patterns = [
    /^(?:请|帮我|给我)?\s*(?:写|生成|创作|起草)\s*(?:一篇|一则|一段|篇)?\s*(?:长文|散文|文章|史论|评论|随笔|前言|正文)?\s*[：:]\s*(.+)$/i,
    /^(?:请|帮我|给我)?\s*(?:写|生成|创作|起草)\s*(?:一篇|篇)?\s*(?:题为|题目为|标题为)\s*[“"']?(.+?)[”"']?$/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return normalized;
}

// 从自然语言 input 里解析目标字数。
// 这是数字解析机制（中文数词 + 阿拉伯数字 → 整数），不是“关键词 -> 字数”硬编码表。
// 只在出现明确的“X字 / X万字”字数意图时返回，否则返回 null，交给上层回退默认值。
// 目的：让 {input} 自给自足——用户在自然语言里说“三千字 / 8000字 / 1.5万字”就能定长度，
// 不必再新增 wordCount/structure 等外部参数表。
function extractTargetWordCountFromNaturalInput(input: unknown): number | null {
  const text = String(input || '').trim();
  if (!text) return null;
  // 匹配“字”前的数字表达：阿拉伯数字（可带小数、可带万）或中文数词串。
  const match = text.match(/([\d.]+\s*万|[\d.]+|[零一二两三四五六七八九十百千万]+)\s*字/);
  if (!match) return null;
  const raw = match[1].replace(/\s+/g, '');
  let value = 0;
  if (/[\d.]/.test(raw)) {
    // 阿拉伯数字分支：纯数字直接取值；带“万”乘 1e4（支持 1.5万 → 15000）。
    const wanMatch = raw.match(/^([\d.]+)万$/);
    value = wanMatch ? Number(wanMatch[1]) * 10000 : Number(raw);
  } else {
    // 中文数词分支：按十/百/千/万组合累加。
    value = parseChineseNumeral(raw);
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

// 中文数词转整数（支持 十/百/千/万 组合，如“一万五千”→15000、“三千”→3000）。
function parseChineseNumeral(text: unknown): number | null {
  const digit: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const ch of String(text || '')) {
    if (ch in digit) {
      number = digit[ch];
    } else if (ch in unit) {
      section += (number || 1) * unit[ch];
      number = 0;
    } else if (ch === '万') {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
    }
  }
  return total + section + number;
}


// 解释结尾为什么不合格。
// 纯诊断判定（被 diagnoseArticleEnding 无条件调用，也被不完整诊断复用），不直接修改正文。
function explainArticleEndingFailures(body: unknown, request: ArticleRequest = {}) {
  const text = String(body || '').trim();
  const tail = text.slice(-80);
  const reasons = [];
  if (!text) reasons.push('empty_body');
  if (/[，、：；,;:]$/.test(tail)) reasons.push('terminal_punctuation_open');
  if (/(因为|由于|如果|当|在|从|把|被|使|让|以及|和|与|而|但|却|并且|然后|最后|例如|比如)$/.test(tail)) reasons.push('terminal_connector_open');
  if (!/[。！？.!?」』”’》]$/.test(tail)) reasons.push('missing_terminal_sentence_punctuation');
  return reasons;
}

// 结尾闭合诊断（传感器）：无条件计算，复用 explainArticleEndingFailures/resolveClosureQuestion，
// 不强制续写也不抛错，只把结尾状态打进 trace 供调用方观测。
function diagnoseArticleEnding(body: unknown, request: ArticleRequest, topic: string): ArticleEndingDiagnostics {
  const text = String(body || '').trim();
  const reasons = explainArticleEndingFailures(text, request);
  return {
    closureQuestion: resolveClosureQuestion(request, topic),
    reasons,
    closed: reasons.length === 0,
    effectiveLength: measureArticleLength(text),
    bodyTail: text.slice(-2400),
  };
}

// 按空行切分段落。
// 用于诊断尾部段落。
function splitParagraphs(text: unknown): string[] {
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}


// 检查请求是否已经被取消。
// HTTP 断开或 job 被取消时，用它及时停止后续生成。
function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(reason ? String(reason) : 'Article generation aborted');
}

// 构造 collection patch plan。
// 如果请求是文集/集合型写作，返回“应当插入到哪里”的补丁计划；普通文章返回 null。
function buildCollectionPatchPlan(request: ArticleRequest, body: string): CollectionPatchPlan | null {
  const plan = isPlainObject(request?.collectionPlan) ? request.collectionPlan : {};
  const placement = isPlainObject(request?.placement) ? request.placement : {};
  const structure = readObject(request.structure);
  const sourceDocument = readObject(request.sourceDocument);
  const structurePlacement = readObject(structure.placement);
  const structureCollection = readObject(structure.collectionPlan);
  const merged = {
    ...structureCollection,
    ...plan,
    ...structurePlacement,
    ...placement,
  };
  const operation = String(merged.operation || request?.operation || 'insert').trim();
  const targetAnchor = String(merged.targetAnchor || request?.targetAnchor || '').trim();
  const insertPosition = String(merged.insertPosition || request?.insertPosition || 'after').trim();
  const contentRole = String(merged.contentRole || request?.contentRole || 'body').trim();
  // 题材已去除：合集补丁计划只看是否给出锚点/源文档，不再按体裁判定。
  if (!targetAnchor && !request.sourceDocument && !request.sourcePath) {
    return null;
  }
  return {
    type: 'markdown_collection_patch',
    operation,
    targetAnchor,
    insertPosition,
    contentRole,
    sourcePath: String(request.sourcePath || sourceDocument.path || '').trim(),
    bodyLength: body.length,
    body,
    rules: [
      'Apply this patch to the existing source document only.',
      'Do not create sibling branch files unless explicitly requested.',
      'Fail if targetAnchor cannot be found unambiguously.',
    ],
  };
}

// 创建统一进度上报函数。
// 内部各阶段只报 stage/message，这里统一加时间戳。
function createProgressReporter(onProgress?: (event: ArticleProgressEvent) => void) {
  return (stage: string, message: string) => {
    if (typeof onProgress === 'function') {
      onProgress({ stage, message, at: new Date().toISOString() });
    }
  };
}

// 润色流程。
// 入口：/api/content/runtime/polish/article。
// 它不检索 EvidencePack，只对已有 body 构造润色 prompt 并调用 Writer。
async function polishArticle(request: unknown, runtime: ArticlePolishDeps): Promise<ArticlePolishResult> {
  const source = isPlainObject(request) ? request : {};
  const body = String(source.body || '').trim();
  if (!body) {
    throw new Error('body is required: pass the text to polish');
  }

  const title = String(source.title || source.topic || '').trim();
  const instruction = String(source.instruction || '按 ContentMRS 风格协议润色，不改变事实，不新增章节').trim();
  // 题材已去除：润色不再解析体裁,直接用通用风格协议润色已有正文。
  const targetChars = Number(source.targetChars || body.length) || body.length;
  const preserveNames = source.preserveNames !== false;
  const preserveStructure = source.preserveStructure !== false;

  const polishPrompt = buildPolishPrompt({
    instruction,
    title,
    targetChars,
    preserveNames,
    preserveStructure,
    body,
  });

  const modelInvocation = await runtime.callSingleWriter(polishPrompt, {
      ...(isPlainObject(source.settings) ? source.settings : {}),
    maxTokens: Math.max(8000, Math.ceil(targetChars * 1.5)),
  });

  let result = String(modelInvocation.body || '').trim();
  if (!result) {
    throw new Error('Writer returned empty result during polish');
  }

  if (result.length > 1000) {
    // 保留原结构时不强制重排段落；否则交给后处理按统一规则判断。
    result = runtime.applyPostProcessing(result, {
      breakUniformParagraphs: preserveStructure ? false : undefined,
    }).result;
  }

  return {
    draft: {
      body: result,
      originalLength: body.length,
      polishedLength: result.length,
      changed: result !== body,
      modelInvocation: modelInvocation.trace,
    },
  };
}

async function finalEditArticle(request: unknown, runtime: ArticleRuntimeDeps, options: ArticleRuntimeOptions = {}): Promise<ArticleFinalEditResult> {
  const source = isPlainObject(request) ? request : {};
  const body = String(source.body || '').trim();
  if (!body) {
    throw new Error('body is required: pass the text to final edit');
  }
  const topic = String(source.topic || source.title || extractArticleTopicFromNaturalInput(body.slice(0, 160)) || '未命名文本').trim();
  const targetWordCount = readPositiveInteger(source.targetWordCount || source.targetChars || measureArticleLength(body), measureArticleLength(body));
  const reportProgress = createProgressReporter(options.onProgress);
  const styleAnchor = String(source.styleAnchor || '').trim();
  const openingImage = String(source.openingImage || '').trim();
  const chapterBoundaries = String(source.chapterBoundaries || '').trim();
  const independentAssessment = buildIndependentFinalEditorAssessment({ body, topic });
  const supplementalMaterials = await loadStandaloneFinalEditorSupplementalMaterials({
    topic,
    body,
    reportProgress,
    request: source,
  });
  const writingBrief = {
    kind: 'writing_brief' as const,
    factNotes: '',
    webRealityNotes: '',
    divergenceNotes: '',
    meaningNotes: '',
    interpretationBrief: independentAssessment,
    styleAnchorBrief: styleAnchor,
    openingImageBrief: openingImage,
    transitionPressureBrief: '',
    chapterBoundaryBrief: chapterBoundaries,
    text: [
      independentAssessment,
      styleAnchor ? `\n[STYLE_ANCHOR]\n${styleAnchor}` : '',
      openingImage ? `\n[OPENING_IMAGE]\n${openingImage}` : '',
      chapterBoundaries ? `\n[CHAPTER_BOUNDARY]\n${chapterBoundaries}` : '',
    ].filter(Boolean).join('\n').trim(),
  };
  const reviewReport: ReviewReport = {
    kind: 'review_report',
    formatReview: '',
    factReview: '',
    styleReview: '',
    deterministicStyleHits: '',
    text: independentAssessment,
  };
  const modelInvocation = await runtime.callSingleWriter(
    buildFinalEditorPrompt({
      topic,
      targetWordCount,
      writingBrief,
      reviewReport,
      body,
      supplementalMaterials,
      contextSections: {
        author: [
          styleAnchor ? `[STYLE_ANCHOR]\n${styleAnchor}` : '',
          openingImage ? `[OPENING_IMAGE]\n${openingImage}` : '',
          chapterBoundaries ? `[CHAPTER_BOUNDARY]\n${chapterBoundaries}` : '',
        ].filter(Boolean).join('\n\n'),
      },
      chapterDiagnostics: buildStandaloneChapterDiagnostics(body),
      independentAssessment,
      lengthWindow: buildStandaloneLengthWindow(targetWordCount),
    }),
    {
      ...(isPlainObject(source.settings) ? source.settings : {}),
      maxTokens: Math.max(12000, Math.ceil(targetWordCount * 2.2)),
      agentName: 'final_editor_agent',
    },
    { signal: options.signal, systemPrompt: getFinalEditorSystemPrompt(), onProgress: (event) => reportProgress(event.stage, event.message) },
  );
  const revised = normalizeFinalEditBody(modelInvocation.body);
  if (!revised) {
    throw new Error('Final Editor Agent returned empty body');
  }
  const finalBody = revised.length > 1000 ? runtime.applyPostProcessing(revised, { breakUniformParagraphs: false, failOnStyleViolations: false }).result : revised;
  return {
    draft: {
      body: finalBody,
      originalLength: body.length,
      finalLength: finalBody.length,
      changed: finalBody !== body,
      modelInvocation: modelInvocation.trace,
    },
    trace: {
      independentAssessment,
      supplementalMaterials,
      styleAnchor,
      openingImage,
      chapterBoundaries,
    },
  };
}

// 解析本文最后必须回答的问题。
// 优先从 episodePlan/structure/request 中取显式母题；没有就用 topic 推导。
function buildIndependentFinalEditorAssessment(input: { body: string; topic: string }): string {
  const body = String(input.body || '').trim();
  const paragraphs = splitParagraphs(body);
  const repeatedStarts = paragraphs
    .map((paragraph) => paragraph.slice(0, 18))
    .filter(Boolean);
  const duplicatedStarts = Array.from(new Set(repeatedStarts.filter((start, index) => repeatedStarts.indexOf(start) !== index)));
  const repeatedSentenceMarkers = (body.match(/不是.{0,18}而是|并非.{0,18}而|问题不在.{0,18}而在/g) || []).length;
  const abstractMarkers = (body.match(/国家机器|现代性|秩序|结构|逻辑|命运|本质|体系/g) || []).length;
  return [
    `主题：${input.topic}`,
    `段落数：${paragraphs.length}`,
    `疑似重复段落起首：${duplicatedStarts.slice(0, 8).join(' / ') || '无明显重复起首'}`,
    `高风险二分转折命中：${repeatedSentenceMarkers}`,
    `高频抽象主语命中：${abstractMarkers}`,
    '终稿编辑要求：优先处理重复承重、空泛判断、局部承接断裂和需要补一小段材料的地方；不要整章重写。',
  ].join('\n');
}

async function loadStandaloneFinalEditorSupplementalMaterials(input: {
  topic: string;
  body: string;
  request: ArticleRequest;
  reportProgress: (stage: string, message: string) => void;
}): Promise<string> {
  const query = String(input.request.query || input.request.searchQuery || input.request.title || input.topic).trim();
  if (!query) return '';
  input.reportProgress('final_editor_materials', 'Loading standalone final-editor materials');
  try {
    const gateway = new LocalCorpus({ timeout: DEFAULT_EVIDENCE_TIMEOUT_MS || 240000 });
    const evidenceQuery = readObject(input.request.evidenceQuery);
    const datasetIds = Array.isArray(evidenceQuery.ragflowDatasetIds)
      ? evidenceQuery.ragflowDatasetIds.map(String).filter(Boolean)
      : [...RAGFLOW_DATASET_IDS];
    const queries = buildStandaloneSupplementalQueries(query, input.topic);
    const evidencePack = await gateway.searchEvidence({
      q: query,
      query,
      limit: '24',
      rounds: '3',
      includeWeb: 'true',
      includeRagflow: 'true',
      persistWeb: 'true',
      webQueries: queries.join('\n'),
    }, datasetIds, DEFAULT_EVIDENCE_TIMEOUT_MS);
    const vectorPack = await gateway.searchVectorBatch(
      queries.slice(0, 4).map((q) => ({ q, limit: 3, tag: 'final-editor-standalone' })),
      DEFAULT_EVIDENCE_TIMEOUT_MS,
    );
    const items = [
      ...extractStandaloneSupplementalItems(evidencePack, 'evidence'),
      ...extractStandaloneSupplementalItems(vectorPack, 'vector'),
    ];
    const unique = filterStandaloneSupplementalItems(items, input.body).slice(0, 12);
    input.reportProgress('final_editor_materials_done', `Standalone final-editor materials raw=${items.length} unique=${unique.length}`);
    return formatStandaloneSupplementalMaterials(unique);
  } catch (error) {
    input.reportProgress('final_editor_materials_failed', error instanceof Error ? error.message : String(error));
    return '';
  }
}

function buildStandaloneLengthWindow(targetWordCount: number) {
  const targetChars = Math.max(1, Math.floor(Number(targetWordCount) || 1));
  const tolerance = Math.min(1000, Math.max(300, Math.floor(targetChars * 0.125)));
  return {
    minChars: Math.max(1, targetChars - tolerance),
    maxChars: targetChars + tolerance,
  };
}

type StandaloneSupplementalMaterial = {
  title?: string;
  source?: string;
  url?: string;
  text: string;
  origin: string;
};

function buildStandaloneSupplementalQueries(query: string, topic: string): string[] {
  const base = normalizeStandaloneInlineText(query || topic);
  const topicText = normalizeStandaloneInlineText(topic);
  const variants = [
    base,
    topicText && topicText !== base ? topicText : '',
    `${base} 史料`,
    `${base} 制度 动作`,
    `${base} 来源 材料`,
    `${base} 案例 事实`,
  ];
  return Array.from(new Set(
    variants
      .map((item) => normalizeStandaloneInlineText(item))
      .filter((item) => item.length >= 2 && item.length <= 120)
  )).slice(0, 8);
}

function extractStandaloneSupplementalItems(payload: unknown, origin: string): StandaloneSupplementalMaterial[] {
  const items: StandaloneSupplementalMaterial[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const text = readStandaloneSupplementalText(record);
    if (text.length >= 80) {
      items.push({
        title: readStandaloneSupplementalString(record, ['title', 'document_name', 'sourceTitle', 'name']),
        source: readStandaloneSupplementalString(record, ['source', 'source_id', 'document_id', 'provider']),
        url: readStandaloneSupplementalString(record, ['url', 'link']),
        text,
        origin,
      });
    }
    for (const key of ['chunks', 'citations', 'sources', 'results', 'items', 'data', 'records']) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  visit(payload, 0);
  return items;
}

function readStandaloneSupplementalText(record: Record<string, unknown>): string {
  return normalizeStandaloneInlineText(
    record.text
    || record.chunk_text
    || record.content
    || record.snippet
    || record.preview
    || record.summary
    || ''
  );
}

function readStandaloneSupplementalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeStandaloneInlineText(record[key]);
    if (value) return value.slice(0, 180);
  }
  return undefined;
}

function filterStandaloneSupplementalItems(items: StandaloneSupplementalMaterial[], body: string): StandaloneSupplementalMaterial[] {
  const bodyText = normalizeStandaloneInlineText(body);
  const seen = new Set<string>();
  const result: StandaloneSupplementalMaterial[] = [];
  for (const item of items) {
    const text = normalizeStandaloneInlineText(item.text);
    if (text.length < 80) continue;
    const key = text.slice(0, 160).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isStandaloneMaterialAlreadyInBody(text, bodyText)) continue;
    result.push({ ...item, text: text.slice(0, 520) });
  }
  return result;
}

function isStandaloneMaterialAlreadyInBody(material: string, body: string): boolean {
  if (!material || !body) return false;
  const direct = material.slice(0, 90);
  if (direct.length >= 60 && body.includes(direct)) return true;
  const sentences = material.split(/[。！？.!?；;]/).map((item) => item.trim()).filter((item) => item.length >= 18);
  const hits = sentences.slice(0, 6).filter((sentence) => body.includes(sentence.slice(0, Math.min(40, sentence.length)))).length;
  return hits >= 2;
}

function formatStandaloneSupplementalMaterials(items: StandaloneSupplementalMaterial[]): string {
  if (!items.length) return '';
  return items.map((item, index) => [
    `材料${index + 1}｜${item.origin}`,
    item.title ? `标题：${item.title}` : '',
    item.source ? `来源：${item.source}` : '',
    item.url ? `链接：${item.url}` : '',
    '使用边界：只补正文薄弱处；不得重复正文已有材料；不得脱离来源扩展事实。',
    `内容：${item.text}`,
  ].filter(Boolean).join('\n')).join('\n\n');
}

function normalizeStandaloneInlineText(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildStandaloneChapterDiagnostics(body: string): string {
  const paragraphs = splitParagraphs(body);
  if (!paragraphs.length) return '';
  const repeatedStarts = Array.from(new Set(
    paragraphs
      .map((paragraph) => paragraph.slice(0, 18))
      .filter((item, index, all) => item && all.indexOf(item) !== index)
  ));
  const repeatedSentenceMarkers = (String(body || '').match(/不是.{0,18}而是|并非.{0,18}而|问题不在.{0,18}而在/g) || []).length;
  const abstractMarkers = (String(body || '').match(/国家机器|现代性|秩序|结构|逻辑|命运|本质|体系/g) || []).length;
  return [
    `段落数=${paragraphs.length}`,
    `重复段落起首=${repeatedStarts.slice(0, 8).join(' / ') || '无'}`,
    `二分转折命中=${repeatedSentenceMarkers}`,
    `抽象主语命中=${abstractMarkers}`,
    '优先重写最差章节块的开头、转场和章末，不要全篇平均修改。',
  ].join('\n');
}

function getFinalEditorSystemPrompt(): string {
  return [
    '你是终稿编辑，不是重写器。',
    '你先整体评估全文，再只对真正需要动刀的局部做终稿编辑。',
    '你只在局部修复、局部补承接、局部删重复、局部补材料，不推翻主线，不输出说明。',
    '不新增没有来源支撑的事实，不写元叙事，不写审稿意见。',
  ].join('\n');
}

function normalizeFinalEditBody(text: unknown): string {
  const source = String(text || '').trim();
  const match = source.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : source).trim();
}

function resolveClosureQuestion(request: ArticleRequest = {}, topic = ''): string {
  const structure = isPlainObject(request?.structure) ? request.structure : {};
  const plan = isPlainObject(request?.episodePlan) ? request.episodePlan
    : isPlainObject(request?.plan) ? request.plan
      : isPlainObject(structure?.episodePlan) ? structure.episodePlan
        : {};
  const explicit = String(
    plan.motherQuestion
    || plan.thesisQuestion
    || plan.coreQuestion
    || structure.motherQuestion
    || structure.thesisQuestion
    || structure.centralQuestion
    || request?.motherQuestion
    || request?.thesisQuestion
    || request?.coreQuestion
    || request?.question
    || request?.goal
    || request?.target
    || topic
    || request?.topic
    || request?.title
    || ''
  ).trim();
  if (!explicit) return '真正要回答的问题';
  const reframed = reframeConceptPairQuestion(explicit);
  if (reframed) return reframed;
  if (/[？?]$/.test(explicit)) return explicit;
  if (/为什么|是什么|如何|怎么|何以|为何/.test(explicit)) return `${explicit}？`;
  return `${explicit}最后需要回收哪些事实后果、制度困境和未解决代价？`;
}

// 重写“概念对”题目。
// 例如“偶然与必然”这种题，终章不能机械重复概念，而要转成可回答的问题。
function reframeConceptPairQuestion(value: unknown): string {
  const text = String(value || '');
  if (/偶然.{0,12}必然|必然.{0,12}偶然/.test(text)) {
    return '这场崩溃与重建传递了哪些旧结构，又把哪些代价转移给新的承担者？';
  }
  if (/传统.{0,12}现代|现代.{0,12}传统/.test(text)) {
    return '旧制度技术如何改换名义进入新秩序，并在新秩序里继续制造代价？';
  }
  if (/帝国.{0,12}民族国家|民族国家.{0,12}帝国/.test(text)) {
    return '帝国遗产如何被现代国家机器重新命名，并变成新的共同体边界？';
  }
  return '';
}


// 读取正整数。
// 配置值合法就用配置值，否则使用默认值。
function readPositiveInteger(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : defaultValue;
}

// 读非负整数（允许 0）。
// 用于“轮次”这类默认 0（单轮）、显式调大才加轮的开关。
function readNonNegativeInteger(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : defaultValue;
}

// 计算文章有效长度。
// 中文长文按 CJK 字数估算；非中文或混合文本按非空白字符估算。
function measureArticleLength(body: unknown): number {
  const text = String(body || '');
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const nonWhitespaceCount = text.replace(/\s/g, '').length;
  return cjkCount >= Math.ceil(nonWhitespaceCount * 0.45)
    ? cjkCount
    : nonWhitespaceCount;
}

// 通用超时包装。
// operation 超过 timeoutMs 时抛错，并可执行 onTimeout 做取消或进度上报。
function withTimeout<T>(operation: () => Promise<T> | T, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      if (typeof onTimeout === 'function') onTimeout();
      reject(new Error(`${message} after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const operationPromise = Promise.resolve().then(operation);
  return Promise.race([operationPromise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

// 判断是否普通对象。
// 用于区分 request 对象和字符串、数组、null。
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}


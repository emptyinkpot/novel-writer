// 文章生产流水线协议：Context Engine、Agent 编排和 Runtime 之间共享的数据形状。
// 这里只定义内部契约，不调用模型、不拼 prompt，也不等同于外部 HTTP API。
// 执行层在 runtime/ / planning/ / context/ / agents/；这里是它们共同遵守的接口边界。
import type { ContextEngineResult } from './planning/context-builder.ts';
import type { WriterResult } from './tools/llm/writer-model.ts';

export type StormResearchResult = {
  perspectives: Array<{ role: string; focus: string }>;
  questions: Array<{ perspective: string; question: string }>;
  outline: string;
  citations: Array<{ title: string; url: string; snippet: string; score: number }>;
  elapsed_ms: number;
};

export type StormDiagnostics = {
  enabled: boolean;
  required: boolean;
  called: boolean;
  status: 'ok' | 'disabled' | 'degraded' | 'failed';
  error: string;
  perspectives: number;
  questions: number;
  outlineChars: number;
  citations: number;
};

export type AgentCall = (
  prompt: string,
  settings?: Record<string, any>,
  options?: { signal?: AbortSignal; systemPrompt?: string; onProgress?: (event: { stage: string; message: string }) => void },
) => Promise<WriterResult>;

export type ArticleAgentInput = {
  topic: string; // 单篇文章的主题真源。
  targetWordCount: number; // 给 agent 判断材料密度和输出预算。
  context: ContextEngineResult; // Context Engine 已召回并装箱后的材料和诊断。
  request: Record<string, unknown>; // 原始请求的归一化版本，供 prompt 读取额外意图。
};

export type FactNotes = {
  kind: 'fact_notes'; // 材料阶段：可写事实、需降级事实和禁写事实。
  text: string; // 模型输出的中文事实底稿，不要求 JSON。
};

export type WebRealityNotes = {
  kind: 'web_reality_notes'; // 材料阶段：当前/公开现实材料和来源边界。
  text: string; // 模型输出的中文现实材料摘录，不要求 JSON。
};

export type DivergenceNotes = {
  kind: 'divergence_notes'; // 材料阶段：文学、场景、类比和意象储备。
  text: string; // 模型输出的中文发散材料，不要求 JSON。
};

export type MeaningNotes = {
  kind: 'meaning_notes'; // 材料阶段：上下文合成、材料分组、风险材料和发散素材；保留字段名以稳定调用链。
  text: string; // 模型输出的中文上下文合成，不要求 JSON。
};

export type WritingBrief = {
  kind: 'writing_brief'; // Author Agent 的唯一材料摘要入口。
  factNotes: string; // Fact Agent 输出的原文。
  webRealityNotes: string; // Web Reality Agent 输出的原文。
  divergenceNotes: string; // Divergence Agent 输出的原文。
  meaningNotes: string; // Context Synthesizer 输出的原文；字段名保留以稳定调用链。
  interpretationBrief: string; // 从 Context Synthesizer 输出中抽取的上下文摘要；字段名保留以稳定调用链。
  styleAnchorBrief?: string; // 从前三章或既有高质量样本抽出的风格锚。
  openingImageBrief?: string; // 开场画面和进入方式。
  transitionPressureBrief?: string; // 段间推进压力与转场方式。
  chapterBoundaryBrief?: string; // 章节边界、章末收束和禁止越界提示。
  text: string; // 拼接后的 brief，直接注入 Author prompt。
};

export type OutlineRoute = {
  kind: 'outline_route'; // 写作阶段：进入正文前的写作路线，不是模板提纲。
  text: string; // Outline Agent 输出的中文路线，不要求 JSON。
  openingBeat?: string; // 从哪里进入本章。
  narrativeThreeBeats?: string; // 章节的三拍推进。
  interparagraphTransitions?: string; // 段与段之间靠什么压力推进。
  chapterClosure?: string; // 一章最后停在哪里。
};

export type ReviewReport = {
  kind: 'review_report'; // 审稿阶段的合并报告。
  formatReview: string; // Format Reviewer 的产品格式意见。
  factReview: string; // Fact Reviewer 的事实风险意见。
  styleReview: string; // Style Reviewer 的文风/结构意见。
  deterministicStyleHits?: string; // 确定性扫描命中的具体句子，交给 Revision Agent 做局部句法修订。
  text: string; // 拼接后的报告，直接交给 Revision Agent。
};

export type FinalEditorMetrics = {
  beforeFinalEdit: StyleRevisionMetrics;
  afterFinalEdit: StyleRevisionMetrics;
};

export type AgentTrace = {
  enabled: boolean; // 当前请求是否启用 agent pipeline。
  config?: Record<string, unknown>; // 本次请求各 agent 的 profile/model/settings 诊断，不含密钥。
  material?: {
    factNotesChars: number;
    webRealityNotesChars: number;
    divergenceNotesChars: number;
    meaningNotesChars: number;
    writingBriefChars: number;
  };
  writing?: {
    outlineRouteChars: number;
    draftBodyChars: number;
    enrichmentCalls: number;
    enrichmentChars: number;
    stageDiagnostics?: Record<string, BodyStageDiagnostics>;
  };
  review?: {
    formatReviewChars: number;
    factReviewChars: number;
    styleReviewChars: number;
    revisionChars: number;
    revisionPasses?: number;
    styleRevisionMetrics?: {
      beforeRevision: StyleRevisionMetrics;
      afterRevision: StyleRevisionMetrics;
      final: StyleRevisionMetrics;
    };
    finalEditorChars?: number;
    finalEditorMetrics?: FinalEditorMetrics;
    stageDiagnostics?: Record<string, BodyStageDiagnostics>;
  };
};

export type StyleRevisionMetrics = {
  totalStyleViolations: number;
  binaryPatternCount: number;
  translationeseCount: number;
  lectureMarkerCount: number;
  punctuationStyleCount: number;
  repairableStyleCount: number;
  topRules: Record<string, number>;
};

export type ChapterDiagnostic = {
  index: number;
  heading: string;
  chars: number;
  openingMissingConcreteAnchor: boolean;
  openingAbstractSubject: boolean;
  repeatedSentenceCount: number;
  repeatedSentenceSamples: string[];
  endingRepeatedLoop: boolean;
  endingRepeatedMotif: boolean;
  abstractSubjectParagraphCount: number;
  comparisonMatrixCount: number;
  score: number;
};

export type BodyStageDiagnostics = {
  chars: number;
  effectiveLength: number;
  repeatedSentenceCount: number;
  repeatedSentenceSamples: string[];
  chapterDiagnostics?: ChapterDiagnostic[];
};

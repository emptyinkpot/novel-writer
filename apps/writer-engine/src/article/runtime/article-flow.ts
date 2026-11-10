import { buildWritingBrief } from '../agents/brief-builder.ts';
import { buildAgentSettings, getArticleAgentDiagnostics } from '../agents/agent-config.ts';
import { runContextSynthesizer } from '../agents/planning/context-synthesizer.ts';
import { runDivergenceAgent } from '../agents/planning/divergence-agent.ts';
import { runFactAgent } from '../agents/planning/fact-agent.ts';
import { runWebRealityAgent } from '../agents/planning/web-reality-agent.ts';
import { runAiResidueReviewer } from '../agents/review/ai-residue-reviewer.ts';
import { runFactReviewer } from '../agents/review/fact-reviewer.ts';
import { runFinalEditorAgent } from '../agents/review/final-editor-agent.ts';
import { runFormatReviewer } from '../agents/review/format-reviewer.ts';
import { runRevisionAgent } from '../agents/review/polish-agent.ts';
import { formatChineseSyntaxRevisionPlan, formatDeterministicStyleHits, formatMandatoryRevisionDocket, summarizeStyleRevisionMetrics } from '../agents/review/review-sensors.ts';
import { runAuthorAgent } from '../agents/writing/author-agent.ts';
import { runEnrichmentAgent } from '../agents/writing/enrichment-agent.ts';
import { runOutlineAgent } from '../agents/writing/outline-agent.ts';
import { RAGFLOW_DATASET_IDS, DEFAULT_EVIDENCE_TIMEOUT_MS } from '../config.ts';
import type { ContextEngineResult } from '../planning/context-builder.ts';
import type { WriterResult } from '../tools/llm/writer-model.ts';
import { DataBaseGatewayClient } from '../tools/database/database-gateway-client.ts';
import type { PostProcessOptions, StyleProfile, StyleViolation } from '../postprocess/index.ts';
import { buildStyleProfile, findStyleViolations, summarizeStyleViolations } from '../postprocess/index.ts';
import type { AgentTrace, ChapterDiagnostic, OutlineRoute, ReviewReport, WritingBrief } from '../contracts.ts';
import { buildIncompleteArticleDiagnostics } from './incomplete-diagnostics.ts';
import { measureArticleLength, resolveLengthWindow, type LengthWindow } from './length-window.ts';
import { evaluateLength } from './length-policy.ts';
import { runRetryingAgent } from './retrying-agent.ts';
import { buildStyleSensorDelta, type StyleSensorDelta } from './style-sensor-delta.ts';

type ArticleRequest = Record<string, unknown>;
type ArticleSettings = Record<string, unknown>;

type ArticleFlowDeps = {
  callSingleWriter: (
    prompt: string,
    settings?: ArticleSettings,
    options?: { signal?: AbortSignal; onProgress?: (event: { stage: string; message: string }) => void },
  ) => Promise<WriterResult>;
  applyPostProcessing: (
    body: string,
    options?: PostProcessOptions & { failOnStyleViolations?: boolean },
  ) => { result: string; log: string[]; styleViolations: StyleViolation[]; styleProfile: StyleProfile };
};

type ContinuationState = {
  body: string;
  continuations: number;
  lastGeneratedSection: string;
  lastGeneratedStage: string;
};

export type ArticleFlowPostProcess = {
  log: string[];
  styleViolations: StyleViolation[];
  styleProfile?: StyleProfile;
  repairEvaluation?: StyleSensorDelta;
};

export type ArticleFlowResult = {
  body: string;
  modelInvocation: WriterResult;
  continuations: number;
  minimumWordCount: number;
  effectiveLength: number;
  postProcess: ArticleFlowPostProcess;
  agentTrace: AgentTrace;
};

export type ArticleMaterialStageResult = {
  factNotes: Awaited<ReturnType<typeof runFactAgent>>;
  webRealityNotes: Awaited<ReturnType<typeof runWebRealityAgent>>;
  divergenceNotes: Awaited<ReturnType<typeof runDivergenceAgent>>;
  meaningNotes: Awaited<ReturnType<typeof runContextSynthesizer>>;
  writingBrief: WritingBrief;
  agentTrace: AgentTrace;
};

const DEFAULT_TARGET_WORD_COUNT = readPositiveInteger(process.env.CONTENTBASE_DEFAULT_TARGET_WORD_COUNT, 8000);
const DEFAULT_MAX_TOKENS = readPositiveInteger(process.env.CONTENTBASE_DEFAULT_MAX_TOKENS, 24000);

export async function runArticleMaterialStage(input: {
  topic: string;
  targetWordCount: number;
  request: ArticleRequest;
  context: ContextEngineResult;
  deps: Pick<ArticleFlowDeps, 'callSingleWriter'>;
  signal?: AbortSignal;
  reportProgress: (stage: string, message: string) => void;
}): Promise<ArticleMaterialStageResult> {
  const { topic, targetWordCount, request, context, deps, signal, reportProgress } = input;
  const agentTrace: AgentTrace = { enabled: true, config: getArticleAgentDiagnostics() };
  reportProgress('agent_material', 'Running Planning material agents');
  const agentInput = {
    topic,
    targetWordCount,
    request,
    context,
    callAgent: deps.callSingleWriter,
    signal,
    onProgress: (event: { stage: string; message: string }) => reportProgress(event.stage, event.message),
  };
  const [factNotes, webRealityNotes, divergenceNotes] = await Promise.all([
    runFactAgent(agentInput),
    runWebRealityAgent(agentInput),
    runDivergenceAgent(agentInput),
  ]);
  const meaningNotes = await runContextSynthesizer({
    ...agentInput,
    factNotes,
    webRealityNotes,
    divergenceNotes,
  });
  const writingBrief = buildWritingBrief({ factNotes, webRealityNotes, divergenceNotes, meaningNotes });
  reportProgress('agent_material_done', `Material context ready briefChars=${writingBrief.text.length}`);
  agentTrace.material = {
    factNotesChars: factNotes.text.length,
    webRealityNotesChars: webRealityNotes.text.length,
    divergenceNotesChars: divergenceNotes.text.length,
    meaningNotesChars: meaningNotes.text.length,
    writingBriefChars: writingBrief.text.length,
  };
  return { factNotes, webRealityNotes, divergenceNotes, meaningNotes, writingBrief, agentTrace };
}

export async function runArticleAgentFlow(input: {
  topic: string;
  targetWordCount: number;
  request: ArticleRequest;
  context: ContextEngineResult;
  deps: ArticleFlowDeps;
  signal?: AbortSignal;
  reportProgress: (stage: string, message: string) => void;
}): Promise<ArticleFlowResult> {
  const { topic, targetWordCount, request, context, deps, signal, reportProgress } = input;
  const materialStage = await runArticleMaterialStage({ topic, targetWordCount, request, context, deps, signal, reportProgress });
  const agentTrace = materialStage.agentTrace;
  const writingBrief = materialStage.writingBrief;
  const agentInput = {
    topic,
    targetWordCount,
    request,
    context,
    callAgent: deps.callSingleWriter,
    signal,
    onProgress: (event: { stage: string; message: string }) => reportProgress(event.stage, event.message),
  };

  const outlineRoute = await runOutlineAgent({ ...agentInput, writingBrief });
  const authorSettings = buildWriterSettings(request, 'author_agent');
  const modelInvocation = await callMainWriterWithTimeout({
    operation: (controller) => runAuthorAgent({
      ...agentInput,
      basePrompt: context.prompt,
      materialSections: context.sections,
      writingBrief,
      outlineRoute,
      settings: authorSettings,
      signal: controller.signal,
    }),
    settings: authorSettings,
    signal,
    reportProgress,
  });
  let body = String(modelInvocation.body || '').trim();
  if (!body) throw new Error('Writer returned no article body');
  const stageDiagnostics: Record<string, ReturnType<typeof diagnoseBodyStage>> = {
    draft: diagnoseBodyStage(body),
  };
  const authorCleanedBody = removeRepeatedLongSentences(body);
  if (authorCleanedBody !== body) {
    reportProgress('author_duplicate_cleanup', `Removed repeated long sentences from Author draft before enrichment chars=${body.length}->${authorCleanedBody.length}`);
    body = authorCleanedBody;
  }
  stageDiagnostics.authorCleaned = diagnoseBodyStage(body);

  const lengthWindow = resolveLengthWindow(targetWordCount);
  const { minChars, maxChars } = lengthWindow;
  const continuationState = await enrichArticleWithinLengthWindow({
    body,
    continuations: 0,
    lengthWindow,
    request,
    reportProgress,
    deps,
    context,
    signal,
    targetWordCount,
    topic,
    writingBrief,
    outlineRoute,
  });
  body = continuationState.body;
  stageDiagnostics.enriched = diagnoseBodyStage(body);
  const continuations = continuationState.continuations;
  agentTrace.writing = {
    outlineRouteChars: outlineRoute.text.length,
    draftBodyChars: String(modelInvocation.body || '').trim().length,
    enrichmentCalls: continuations,
    enrichmentChars: continuationState.lastGeneratedStage === 'enrichment'
      ? continuationState.lastGeneratedSection.length
      : 0,
    stageDiagnostics: {
      draft: stageDiagnostics.draft,
      authorCleaned: stageDiagnostics.authorCleaned,
      enriched: stageDiagnostics.enriched,
    },
  };
  let lengthCheck = evaluateLength(body, lengthWindow, 'writer_draft');
  if (!lengthCheck.ok && lengthCheck.effective < minChars) {
    throwIncompleteArticleError(`Writer returned incomplete article: ${lengthCheck.reason}`, body, request, continuationState);
  }

  let postProcess: ArticleFlowPostProcess = { log: [], styleViolations: [] };
  if (body.length > 1000) {
    reportProgress('postprocess', 'Applying article postprocess');
    const firstPostProcess = deps.applyPostProcessing(body, { failOnStyleViolations: false });
    body = firstPostProcess.result;
    stageDiagnostics.postprocess = diagnoseBodyStage(body);
    postProcess = {
      log: firstPostProcess.log || [],
      styleViolations: firstPostProcess.styleViolations || [],
      styleProfile: firstPostProcess.styleProfile,
    };
    lengthCheck = evaluateLength(body, lengthWindow, 'postprocess');
    if (lengthCheck.effective < minChars) {
      throwIncompleteArticleError(`Postprocess shortened article below target window: ${lengthCheck.reason}`, body, request, continuationState);
    }
  }

  const firstReviewScan = deps.applyPostProcessing(body, { breakUniformParagraphs: false });
  reportProgress('agent_review', 'Running Format, Fact and Style Reviewers');
  const deterministicStyleHits = [
    formatDeterministicStyleHits(firstReviewScan.styleViolations || []),
    formatChineseSyntaxRevisionPlan(firstReviewScan.styleViolations || []),
    formatMandatoryRevisionDocket(firstReviewScan.styleViolations || []),
    formatRepeatedSentenceHits(diagnoseBodyStage(body).repeatedSentenceSamples),
  ].filter(Boolean).join('\n\n');
  const reviewInput = {
    ...agentInput,
    writingBrief,
    body,
    styleSummary: summarizeStyleViolations(firstReviewScan.styleViolations || []),
    styleViolations: firstReviewScan.styleViolations || [],
    deterministicStyleHits,
  };
  const [formatReview, factReview, styleReview] = await Promise.all([
    runFormatReviewer(reviewInput),
    runFactReviewer(reviewInput),
    runAiResidueReviewer(reviewInput),
  ]);
  const reviewReport = {
    kind: 'review_report' as const,
    formatReview,
    factReview,
    styleReview,
    deterministicStyleHits,
    text: [
      '[FORMAT_REVIEW]',
      formatReview,
      '',
      '[FACT_REVIEW]',
      factReview,
      '',
      '[STYLE_REVIEW]',
      styleReview,
    ].join('\n').trim(),
  };
  reportProgress('agent_review_done', `Review agents ready reportChars=${reviewReport.text.length}`);

  let revised = await runRevisionAgent({
    ...agentInput,
    writingBrief,
    reviewReport,
    body,
  });
  body = revised;
  stageDiagnostics.revised = diagnoseBodyStage(body);
  lengthCheck = evaluateLength(body, lengthWindow, 'revision');
  if (lengthCheck.effective < minChars) {
    throwIncompleteArticleError(`Revision Agent shortened article below target window: ${lengthCheck.reason}`, body, request, continuationState);
  }

  let revisionScan = deps.applyPostProcessing(body, { breakUniformParagraphs: false });
  let revisionPasses = 1;
  const firstRevisionEffect = summarizeStyleRevisionEffect(firstReviewScan.styleViolations || [], revisionScan.styleViolations || []);
  if (shouldRunSecondRevisionPass(firstRevisionEffect)) {
    reportProgress('agent_revision_retry', `Revision Agent style metrics unchanged repairable=${firstRevisionEffect.beforeRepairable}->${firstRevisionEffect.afterRepairable}; running one more editor pass`);
    const secondReviewReport = {
      ...reviewReport,
      deterministicStyleHits: [
        reviewReport.deterministicStyleHits || '',
        '',
        '[REVISION_EFFECT_FEEDBACK]',
        formatRevisionEffectFeedback(firstRevisionEffect, revisionScan.styleViolations || []),
      ].join('\n').trim(),
      text: [
        reviewReport.text,
        '',
        '[REVISION_EFFECT_FEEDBACK]',
        formatRevisionEffectFeedback(firstRevisionEffect, revisionScan.styleViolations || []),
      ].join('\n').trim(),
    };
    revised = await runRevisionAgent({
      ...agentInput,
      writingBrief,
      reviewReport: secondReviewReport,
      body,
    });
    body = revised;
    revisionPasses = 2;
    stageDiagnostics.revised = diagnoseBodyStage(body);
    lengthCheck = evaluateLength(body, lengthWindow, 'revision_second_pass');
    if (lengthCheck.effective < minChars) {
      throwIncompleteArticleError(`Second Revision Agent pass shortened article below target window: ${lengthCheck.reason}`, body, request, continuationState);
    }
    revisionScan = deps.applyPostProcessing(body, { breakUniformParagraphs: false });
  }
  const supplementalMaterials = await loadFinalEditorSupplementalMaterials({
    topic,
    request,
    body,
    reportProgress,
  });
  const chapterDiagnostics = formatChapterDiagnostics(stageDiagnostics.revised?.chapterDiagnostics || []);
  const finalEditorReviewReport: ReviewReport = {
    ...reviewReport,
    text: [
      reviewReport.text,
      '',
      '[FINAL_EDITOR_CONTEXT]',
      '终稿编辑阶段允许在不改变主线的前提下处理全文重复、局部空转和缺少承接的问题。',
      '如果补充材料足够，只能做局部补写；不能整章重写。',
    ].join('\n').trim(),
  };
  body = await runFinalEditorAgent({
    ...agentInput,
    writingBrief,
    reviewReport: finalEditorReviewReport,
    body,
    supplementalMaterials,
    contextSections: context.sections,
    chapterDiagnostics,
  });
  stageDiagnostics.finalEditor = diagnoseBodyStage(body);
  lengthCheck = evaluateLength(body, lengthWindow, 'final_editor');
  if (lengthCheck.effective < minChars) {
    throwIncompleteArticleError(`Final Editor Agent shortened article below target window: ${lengthCheck.reason}`, body, request, continuationState);
  }

  const finalEditorScan = deps.applyPostProcessing(body, { breakUniformParagraphs: false });
  let repairEvaluation = buildStyleSensorDelta(revisionScan.styleViolations || [], finalEditorScan.styleViolations || [], false);
  if (body.length > 1000) {
    reportProgress('postprocess_revision', 'Applying final format postprocess after Final Editor Agent');
    const finalPostProcess = deps.applyPostProcessing(body, {
      breakUniformParagraphs: false,
      failOnStyleViolations: false,
    });
    body = finalPostProcess.result;
    stageDiagnostics.final = diagnoseBodyStage(body);
    repairEvaluation = buildStyleSensorDelta(finalEditorScan.styleViolations || [], finalPostProcess.styleViolations || [], false);
    postProcess = {
      log: [...(postProcess.log || []), ...(finalPostProcess.log || [])],
      styleViolations: finalPostProcess.styleViolations || [],
      styleProfile: finalPostProcess.styleProfile,
      repairEvaluation,
    };
    lengthCheck = evaluateLength(body, lengthWindow, 'final_postprocess');
    if (lengthCheck.effective < minChars) {
      throwIncompleteArticleError(`Final article below target window after review and repair: ${lengthCheck.reason}`, body, request, continuationState);
    }
  }
  agentTrace.review = {
    formatReviewChars: reviewReport.formatReview.length,
    factReviewChars: reviewReport.factReview.length,
    styleReviewChars: reviewReport.styleReview.length,
    revisionChars: revised.length,
    revisionPasses,
    finalEditorChars: stageDiagnostics.finalEditor?.chars || 0,
    styleRevisionMetrics: {
      beforeRevision: summarizeStyleRevisionMetrics(firstReviewScan.styleViolations || []),
      afterRevision: summarizeStyleRevisionMetrics(revisionScan.styleViolations || []),
      final: summarizeStyleRevisionMetrics(postProcess.styleViolations || []),
    },
    finalEditorMetrics: {
      beforeFinalEdit: summarizeStyleRevisionMetrics(revisionScan.styleViolations || []),
      afterFinalEdit: summarizeStyleRevisionMetrics(finalEditorScan.styleViolations || []),
    },
    stageDiagnostics: {
      postprocess: stageDiagnostics.postprocess || stageDiagnostics.enriched,
      revised: stageDiagnostics.revised,
      finalEditor: stageDiagnostics.finalEditor || stageDiagnostics.revised,
      final: stageDiagnostics.final || stageDiagnostics.finalEditor || stageDiagnostics.revised,
    },
  };

  return {
    body,
    modelInvocation,
    continuations,
    minimumWordCount: minChars,
    effectiveLength: measureArticleLength(body),
    postProcess,
    agentTrace,
  };
}

function diagnoseBodyStage(body: string) {
  const repeated = collectRepeatedSentenceSamples(body, 8);
  return {
    chars: String(body || '').length,
    effectiveLength: measureArticleLength(body),
    repeatedSentenceCount: repeated.count,
    repeatedSentenceSamples: repeated.samples,
    chapterDiagnostics: buildChapterDiagnostics(body),
  };
}

function buildChapterDiagnostics(body: string): ChapterDiagnostic[] {
  const source = String(body || '').trim();
  if (!source) return [];
  const blocks = source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .reduce<Array<{ heading: string; paragraphs: string[] }>>((acc, block) => {
      if (/^##\s+/.test(block)) {
        acc.push({ heading: block.replace(/^##\s+/, '').trim(), paragraphs: [] });
        return acc;
      }
      if (!acc.length) {
        acc.push({ heading: '未命名正文', paragraphs: [] });
      }
      acc[acc.length - 1].paragraphs.push(block);
      return acc;
    }, []);
  return blocks
    .map((block, index) => buildChapterDiagnostic(block.heading, block.paragraphs, index + 1))
    .filter(Boolean) as ChapterDiagnostic[];
}

function buildChapterDiagnostic(heading: string, paragraphs: string[], index: number): ChapterDiagnostic | null {
  const text = paragraphs.join('\n\n').trim();
  if (!text) return null;
  const violations = findStyleViolations(text);
  const styleProfile = buildStyleProfile(text, violations);
  const repeated = collectRepeatedSentenceSamples(text, 6);
  const endingRepeatedLoop = violations.some((item) => item.rule === 'ending_repeated_sentence_loop');
  const endingRepeatedMotif = violations.some((item) => item.rule === 'ending_repeated_motif_loop');
  const abstractSubjectParagraphCount = violations.filter((item) => item.rule === 'abstract_subject_paragraph').length;
  const comparisonMatrixCount = violations.filter((item) => item.rule === 'comparison_matrix_paragraph_run').length;
  let score = 100;
  if (!styleProfile.openingHasConcreteAnchor) score -= 18;
  if (styleProfile.openingAbstractSubject) score -= 15;
  score -= Math.min(16, repeated.count * 4);
  if (endingRepeatedLoop) score -= 12;
  if (endingRepeatedMotif) score -= 8;
  score -= Math.min(15, abstractSubjectParagraphCount * 3);
  score -= Math.min(12, comparisonMatrixCount * 4);
  score -= Math.min(10, Math.round(styleProfile.aiResidueScore));
  return {
    index,
    heading,
    chars: text.length,
    openingMissingConcreteAnchor: !styleProfile.openingHasConcreteAnchor,
    openingAbstractSubject: styleProfile.openingAbstractSubject,
    repeatedSentenceCount: repeated.count,
    repeatedSentenceSamples: repeated.samples,
    endingRepeatedLoop,
    endingRepeatedMotif,
    abstractSubjectParagraphCount,
    comparisonMatrixCount,
    score: Math.max(0, score),
  };
}

function summarizeStyleRevisionEffect(before: StyleViolation[], after: StyleViolation[]) {
  const beforeMetrics = summarizeStyleRevisionMetrics(before);
  const afterMetrics = summarizeStyleRevisionMetrics(after);
  return {
    beforeRepairable: beforeMetrics.repairableStyleCount,
    afterRepairable: afterMetrics.repairableStyleCount,
    beforeBinary: beforeMetrics.binaryPatternCount,
    afterBinary: afterMetrics.binaryPatternCount,
    beforeTranslationese: beforeMetrics.translationeseCount,
    afterTranslationese: afterMetrics.translationeseCount,
    beforePunctuation: beforeMetrics.punctuationStyleCount,
    afterPunctuation: afterMetrics.punctuationStyleCount,
  };
}

function shouldRunSecondRevisionPass(effect: ReturnType<typeof summarizeStyleRevisionEffect>): boolean {
  if (effect.beforeRepairable <= 0) return false;
  const repairableDrop = effect.beforeRepairable - effect.afterRepairable;
  const binaryDrop = effect.beforeBinary - effect.afterBinary;
  const translationeseDrop = effect.beforeTranslationese - effect.afterTranslationese;
  return repairableDrop <= 0 || (effect.beforeBinary >= 8 && binaryDrop <= 1) || (effect.beforeTranslationese >= 4 && translationeseDrop <= 0);
}

function formatRevisionEffectFeedback(effect: ReturnType<typeof summarizeStyleRevisionEffect>, violations: StyleViolation[]): string {
  return [
    '上一轮 Revision Agent 已返回完整正文，但确定性扫描显示主要可修订问题没有明显下降。',
    `可修订命中：${effect.beforeRepairable} -> ${effect.afterRepairable}`,
    `二分对照：${effect.beforeBinary} -> ${effect.afterBinary}`,
    `欧化语序：${effect.beforeTranslationese} -> ${effect.afterTranslationese}`,
    `标点解释腔：${effect.beforePunctuation} -> ${effect.afterPunctuation}`,
    '这不是要求机械替换。请像文字编辑一样处理当前正文中仍然命中的句子：能顺写就顺写，空泛总结就删除/并入，必要对照才保留。',
    '',
    '[当前仍命中的句子样例]',
    formatChineseSyntaxRevisionPlan(violations || [], 24),
    '',
    formatMandatoryRevisionDocket(violations || [], 80),
  ].join('\n');
}

function collectRepeatedSentenceSamples(body: string, limit: number): { count: number; samples: string[] } {
  const counts = new Map<string, { count: number; sample: string }>();
  for (const sentence of splitSentences(body)) {
    const key = normalizeSentenceKey(sentence);
    if (!key || key.length < 24) continue;
    const current = counts.get(key);
    counts.set(key, {
      count: (current?.count || 0) + 1,
      sample: current?.sample || sentence,
    });
  }
  const repeated = Array.from(counts.values()).filter((item) => item.count > 1);
  return {
    count: repeated.length,
    samples: repeated.slice(0, limit).map((item) => item.sample),
  };
}

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSentenceKey(sentence: string): string {
  return String(sentence || '')
    .replace(/\s+/g, '')
    .replace(/[，,；;：“”"‘’'（）()《》、·]/g, '')
    .trim();
}

function removeRepeatedLongSentences(body: string): string {
  const source = String(body || '');
  const parts = source.split(/(\n{2,})/);
  const seen = new Set<string>();
  let changed = false;
  const next = parts.map((part) => {
    if (/^\n{2,}$/.test(part)) return part;
    const segments = part.match(/[^。！？!?]+[。！？!?]?/g);
    if (!segments) return part;
    const kept: string[] = [];
    for (const segment of segments) {
      const key = normalizeSentenceKey(segment);
      if (key.length >= 24 && seen.has(key)) {
        changed = true;
        continue;
      }
      if (key.length >= 24) seen.add(key);
      kept.push(segment);
    }
    return kept.join('');
  }).join('');
  return changed ? next.replace(/\n{3,}/g, '\n\n').trim() : source;
}

function formatRepeatedSentenceHits(samples: string[]): string {
  if (!samples.length) return '';
  return [
    '## 确定性重复长句命中',
    ...samples.map((sample, index) => `${index + 1}. ${sample}`),
    '处理要求：这些是正文中已经重复出现的长句。Revision Agent 只能删除后一次重复或做局部承接，不得改写成新观点。',
  ].join('\n');
}

function formatChapterDiagnostics(chapters: ChapterDiagnostic[]): string {
  if (!chapters.length) return '';
  const sorted = [...chapters].sort((left, right) => left.score - right.score).slice(0, 6);
  return sorted.map((chapter) => [
    `章节${chapter.index}｜${chapter.heading}`,
    `score=${chapter.score}`,
    `openingMissingConcreteAnchor=${chapter.openingMissingConcreteAnchor}`,
    `openingAbstractSubject=${chapter.openingAbstractSubject}`,
    `repeatedSentenceCount=${chapter.repeatedSentenceCount}`,
    `endingRepeatedLoop=${chapter.endingRepeatedLoop}`,
    `endingRepeatedMotif=${chapter.endingRepeatedMotif}`,
    `abstractSubjectParagraphCount=${chapter.abstractSubjectParagraphCount}`,
    `comparisonMatrixCount=${chapter.comparisonMatrixCount}`,
    chapter.repeatedSentenceSamples.length ? `重复句样例：${chapter.repeatedSentenceSamples.join(' / ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function enrichArticleWithinLengthWindow({
  body,
  continuations,
  lengthWindow,
  request,
  reportProgress,
  deps,
  context,
  signal,
  targetWordCount,
  topic,
  writingBrief,
  outlineRoute,
}: {
  body: string;
  continuations: number;
  lengthWindow: LengthWindow;
  request: ArticleRequest;
  reportProgress: (stage: string, message: string) => void;
  deps: ArticleFlowDeps;
  context: ContextEngineResult;
  signal?: AbortSignal;
  targetWordCount: number;
  topic: string;
  writingBrief: WritingBrief;
  outlineRoute: OutlineRoute;
}): Promise<ContinuationState> {
  let currentBody = body;
  let currentContinuations = continuations;
  let lastGeneratedSection = '';
  let lastGeneratedStage = '';

  // Already within the floor → enrichment is a no-op (it only tops the article up; an
  // over-ceiling body is left for the downstream window-aware stages to trim).
  const startLength = evaluateLength(currentBody, lengthWindow, 'enrichment_precheck');
  if (startLength.effective >= lengthWindow.minChars) {
    if (startLength.effective > lengthWindow.maxChars) {
      reportProgress('length_window_over', `Article exceeds target window: chars=${startLength.effective}, window=${lengthWindow.minChars}-${lengthWindow.maxChars}`);
    }
    return { body: currentBody, continuations: currentContinuations, lastGeneratedSection, lastGeneratedStage };
  }

  // Accumulative retry-with-feedback through the shared abstraction: each attempt
  // enriches the current (growing) body further. Reaching the floor returns; exhausting
  // all attempts throws a labeled 'agent_enrichment' error (no longer a silent fall-through
  // that the post-loop check mis-reports as a generic "Writer incomplete").
  const enriched = await runRetryingAgent({
    label: 'agent_enrichment',
    maxAttempts: 6,
    attempt: async (retryFeedback, attemptNumber) => {
      throwIfAborted(signal);
      const effectiveLength = measureArticleLength(currentBody);
      reportProgress('enrichment', `Calling Enrichment Agent for internal supplementation attempt=${attemptNumber} chars=${effectiveLength}, window=${lengthWindow.minChars}-${lengthWindow.maxChars}`);
      const targetAfterEnrichment = Math.min(
        lengthWindow.maxChars - 650,
        Math.max(lengthWindow.minChars + 250, Math.floor(lengthWindow.targetChars * 0.98)),
      );
      const maxAddedEffectiveChars = Math.max(1, lengthWindow.maxChars - effectiveLength - 300);
      const currentRawChars = String(currentBody || '').length;
      const neededEffectiveChars = Math.max(1, targetAfterEnrichment - effectiveLength);
      const effectiveDrivenRawTarget = currentRawChars + Math.ceil(neededEffectiveChars * 1.55) + 450;
      const targetRawChars = Math.min(
        lengthWindow.maxChars - 300,
        Math.max(lengthWindow.minChars + 350, Math.floor(lengthWindow.targetChars * 1.03), effectiveDrivenRawTarget),
      );
      const maxAddedRawChars = Math.max(1, targetRawChars - currentRawChars);
      const supplementalMaterials = await loadEnrichmentSupplementalMaterials({
        topic,
        request,
        body: currentBody,
        reportProgress,
      });
      const result = await runEnrichmentAgent({
        topic,
        targetWordCount,
        request,
        context,
        callAgent: deps.callSingleWriter,
        writingBrief,
        outlineRoute,
        body: currentBody,
        minChars: lengthWindow.minChars,
        maxChars: lengthWindow.maxChars,
        currentEffectiveChars: effectiveLength,
        neededEffectiveChars,
        targetEffectiveChars: targetAfterEnrichment,
        maxAddedEffectiveChars,
        currentRawChars,
        targetRawChars,
        maxAddedRawChars,
        factBoundary: buildEnrichmentFactBoundary(request, currentBody, writingBrief),
        supplementalMaterials,
        retryFeedback,
        signal,
        onProgress: (event) => reportProgress(event.stage, event.message),
      });
      currentBody = result;
      currentContinuations += 1;
      lastGeneratedSection = result;
      lastGeneratedStage = 'enrichment';
      return result;
    },
    validate: (output) => {
      const evaluation = evaluateLength(output, lengthWindow, 'enrichment');
      if (evaluation.effective < evaluation.minChars) {
        throw new Error(evaluation.reason);
      }
    },
    buildFeedback: (lastError) => `上次补充后仍不达标：${lastError}。这次必须输出能精确锚定到正文已有句子、且不与现有内容重复的 JSON 插入补丁，把有效汉字数补到 ${lengthWindow.minChars} 以上，不要靠标点、换行或重复句凑数。`,
    report: (event) => reportProgress(event.stage, event.message),
  });

  return {
    body: enriched,
    continuations: currentContinuations,
    lastGeneratedSection,
    lastGeneratedStage,
  };
}

async function callMainWriterWithTimeout(input: {
  operation: (controller: AbortController) => Promise<WriterResult>;
  settings: ArticleSettings;
  signal?: AbortSignal;
  reportProgress: (stage: string, message: string) => void;
}): Promise<WriterResult> {
  const { operation, settings, signal, reportProgress } = input;
  const timeoutMs = readPositiveInteger(
    settings?.requestTimeoutMs
      ?? settings?.timeoutMs
      ?? process.env.CONTENTBASE_WRITER_NON_STREAM_TIMEOUT_MS
      ?? process.env.CONTENTBASE_WRITER_REQUEST_TIMEOUT_MS,
    330000,
  );
  const controller = new AbortController();
  const detachAbort = linkAbortSignal(signal, controller);
  try {
    return await withTimeout(
      () => operation(controller),
      timeoutMs,
      `main writer timed out after ${timeoutMs}ms`,
      () => {
        controller.abort(new Error(`main writer timed out after ${timeoutMs}ms`));
        reportProgress('writer_timeout', `Main writer timed out after ${timeoutMs}ms`);
      },
    );
  } finally {
    detachAbort();
  }
}

async function loadEnrichmentSupplementalMaterials(input: {
  topic: string;
  request: ArticleRequest;
  body: string;
  reportProgress: (stage: string, message: string) => void;
}): Promise<string> {
  return loadSupplementalMaterials({
    ...input,
    stagePrefix: 'enrichment_materials',
    vectorTag: 'enrichment',
    maxItems: 10,
  });
}

async function loadFinalEditorSupplementalMaterials(input: {
  topic: string;
  request: ArticleRequest;
  body: string;
  reportProgress: (stage: string, message: string) => void;
}): Promise<string> {
  return loadSupplementalMaterials({
    ...input,
    stagePrefix: 'final_editor_materials',
    vectorTag: 'final-editor',
    maxItems: 12,
  });
}

async function loadSupplementalMaterials(input: {
  topic: string;
  request: ArticleRequest;
  body: string;
  reportProgress: (stage: string, message: string) => void;
  stagePrefix: string;
  vectorTag: string;
  maxItems: number;
  timeoutMs?: number;
}): Promise<string> {
  const query = readSupplementalQuery(input.request, input.topic);
  if (!query) return '';
  input.reportProgress(input.stagePrefix, 'Loading supplemental DataBase/RAG/Web materials');
  try {
    const supplementalTimeoutMs = input.timeoutMs || readPositiveInteger(
      process.env.CONTENTBASE_SUPPLEMENTAL_EVIDENCE_TIMEOUT_MS,
      30000,
    );
    const gateway = new DataBaseGatewayClient({ timeout: supplementalTimeoutMs });
    const evidenceQuery = readObject(input.request.evidenceQuery);
    const datasetIds = Array.isArray(evidenceQuery.ragflowDatasetIds)
      ? evidenceQuery.ragflowDatasetIds.map(String).filter(Boolean)
      : [...RAGFLOW_DATASET_IDS];
    const supplementalQueries = buildSupplementalQueries(query, input.topic);
    const evidencePack = await gateway.searchEvidence({
      q: query,
      query,
      limit: '12',
      rounds: '1',
      includeWeb: 'false',
      includeRagflow: 'true',
      persistWeb: 'false',
      webQueries: supplementalQueries.slice(0, 3).join('\n'),
    }, datasetIds, supplementalTimeoutMs);
    const vectorPack = await gateway.searchVectorBatch(
      supplementalQueries.slice(0, 3).map((q) => ({ q, limit: 2, tag: input.vectorTag })),
      supplementalTimeoutMs,
    );
    const items = [
      ...extractSupplementalItems(evidencePack, 'evidence'),
      ...extractSupplementalItems(vectorPack, 'vector'),
    ];
    const unique = filterUnusedSupplementalItems(items, input.body).slice(0, input.maxItems);
    input.reportProgress(`${input.stagePrefix}_done`, `Supplemental materials loaded raw=${items.length} unique=${unique.length}`);
    return formatSupplementalMaterials(unique);
  } catch (error) {
    input.reportProgress(`${input.stagePrefix}_failed`, error instanceof Error ? error.message : String(error));
    return '';
  }
}

function buildWriterSettings(request: ArticleRequest, agentName: 'author_agent' = 'author_agent'): ArticleSettings {
  const settings = {
    ...buildAgentSettings(agentName),
    ...(isPlainObject(request?.settings) ? request.settings : {}),
  };
  const structure = readObject(request.structure);
  const targetWordCount = readPositiveInteger(
    request?.wordCount
      ?? structure.targetWordCount
      ?? request?.targetWordCount
      ?? process.env.CONTENTBASE_DEFAULT_TARGET_WORD_COUNT,
    DEFAULT_TARGET_WORD_COUNT,
  );
  settings.maxTokens = readPositiveInteger(
    settings.maxTokens ?? settings.max_tokens ?? process.env.CONTENTBASE_DEFAULT_MAX_TOKENS,
    Math.max(DEFAULT_MAX_TOKENS, Math.ceil(targetWordCount * 3)),
  );
  return settings;
}

function buildEnrichmentFactBoundary(request: ArticleRequest, body: string, writingBrief?: WritingBrief): string {
  const factNotes = extractPromptSection(writingBrief?.text || writingBrief?.factNotes || '', 'FACT_NOTES');
  const requestFacts = [
    request?.topic,
    request?.title,
    request?.target,
    request?.evidenceQuery,
    request?.structure,
  ]
    .map((item) => compactFactBoundaryText(item, 700))
    .filter(Boolean);
  const bodyAnchors = extractBodyFactAnchors(body);
  return [
    '内部补充只能使用以下事实边界内的对象：',
    factNotes ? `FACT_NOTES 摘要：${compactFactBoundaryText(factNotes, 1600)}` : '',
    requestFacts.length ? requestFacts.join('\n') : '',
    bodyAnchors ? `已成正文中的事实锚点：${bodyAnchors}` : '',
    '没有在上述边界或已成正文中出现的具体人名、地名、年份、文件名、统计数字、日志、天气、房间和当代案例，都不得新增。',
  ].filter(Boolean).join('\n');
}

type SupplementalMaterial = {
  title?: string;
  source?: string;
  url?: string;
  text: string;
  origin: string;
};

function readSupplementalQuery(request: ArticleRequest, topic: string): string {
  const evidenceQuery = readObject(request.evidenceQuery);
  return String(
    evidenceQuery.query
    || request.searchQuery
    || request.query
    || request.target
    || request.title
    || topic
    || ''
  ).trim();
}

function buildSupplementalQueries(query: string, topic: string): string[] {
  const base = normalizeInlineText(query || topic);
  const topicText = normalizeInlineText(topic);
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
      .map((item) => normalizeInlineText(item))
      .filter((item) => item.length >= 2 && item.length <= 120)
  )).slice(0, 8);
}

function extractSupplementalItems(payload: unknown, origin: string): SupplementalMaterial[] {
  const items: SupplementalMaterial[] = [];
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
    const text = readSupplementalText(record);
    if (text.length >= 80) {
      items.push({
        title: readSupplementalString(record, ['title', 'document_name', 'sourceTitle', 'name']),
        source: readSupplementalString(record, ['source', 'source_id', 'document_id', 'provider']),
        url: readSupplementalString(record, ['url', 'link']),
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

function readSupplementalText(record: Record<string, unknown>): string {
  return normalizeInlineText(
    record.text
    || record.chunk_text
    || record.content
    || record.snippet
    || record.preview
    || record.summary
    || ''
  );
}

function readSupplementalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeInlineText(record[key]);
    if (value) return value.slice(0, 180);
  }
  return undefined;
}

function filterUnusedSupplementalItems(items: SupplementalMaterial[], body: string): SupplementalMaterial[] {
  const bodyText = normalizeInlineText(body);
  const seen = new Set<string>();
  const result: SupplementalMaterial[] = [];
  for (const item of items) {
    const text = normalizeInlineText(item.text);
    if (text.length < 80) continue;
    const key = text.slice(0, 160).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isMaterialAlreadyInBody(text, bodyText)) continue;
    result.push({ ...item, text: text.slice(0, 520) });
  }
  return result;
}

function isMaterialAlreadyInBody(material: string, body: string): boolean {
  if (!material || !body) return false;
  const direct = material.slice(0, 90);
  if (direct.length >= 60 && body.includes(direct)) return true;
  const sentences = material.split(/[。！？.!?；;]/).map((item) => item.trim()).filter((item) => item.length >= 18);
  const hits = sentences.slice(0, 6).filter((sentence) => body.includes(sentence.slice(0, Math.min(40, sentence.length)))).length;
  return hits >= 2;
}

function formatSupplementalMaterials(items: SupplementalMaterial[]): string {
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

function throwIncompleteArticleError(message: string, body: unknown, request: ArticleRequest, continuationState: Partial<ContinuationState> = {}) {
  const error = new Error(message) as Error & { diagnostics?: ReturnType<typeof buildIncompleteArticleDiagnostics> };
  error.name = 'IncompleteArticleError';
  error.diagnostics = buildIncompleteArticleDiagnostics(body, continuationState);
  throw error;
}

function compactFactBoundaryText(value: unknown, limit: number): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function normalizeInlineText(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractPromptSection(text: unknown, sectionName: string): string {
  const source = String(text || '');
  const start = source.indexOf(`[${sectionName}]`);
  if (start < 0) return source.trim();
  const after = source.slice(start + sectionName.length + 2);
  const next = after.search(/\n\[[A-Z_]+\]\n?/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function extractBodyFactAnchors(body: string): string {
  const text = String(body || '');
  const matches = text.match(/(?:[12][0-9]{3}年|[一二三四五六七八九十〇零]{2,4}年|[A-Z][A-Za-z-]{2,}|《[^》]{2,30}》|[\u4e00-\u9fff]{2,18}(?:战争|战役|条约|协定|会议|宣言|公司|机构|组织|政府|政权|军队|舰队|铁路|港口|海峡|运河|海关|银行|财政|调查部|总局|司令部|计划|报告|制度|体系))/g) || [];
  const seen = new Set<string>();
  const anchors: string[] = [];
  for (const match of matches) {
    const normalized = match.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    anchors.push(normalized);
    if (anchors.length >= 40) break;
  }
  return anchors.join('、');
}


function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(reason ? String(reason) : 'Article generation aborted');
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => {};
  const abort = () => target.abort(source.reason);
  if (source.aborted) {
    abort();
    return () => {};
  }
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

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

function readPositiveInteger(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : defaultValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

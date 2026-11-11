// 上下文引擎源码：把用户输入转成 DataBase Gateway 查询，并把 Reality/Literary/Semantic 等语料组装进 Writer prompt。
// 这里负责生成前的证据、召回、STORM 研究规划、去重、预算和诊断；不做正文生成。
import { LocalCorpus } from '../tools/corpus/local-corpus.ts';
import { getAssociationModelService, getContextWindowModel, getResearchModelService, getStormResearchConfig } from '../../config/env.ts';
import { requestJson } from '../tools/http/http-client.ts';
import {
  MODEL_CONTEXT_WINDOWS, DEFAULT_MODEL_CONTEXT_WINDOW,
  CONTEXT_UTILIZATION_RATIO, SYSTEM_PROMPT_RESERVE, OUTPUT_TOKEN_RESERVE,
  DEFAULT_CONTEXT_TOKEN_BUDGET, DEFAULT_CONTEXT_CHAR_BUDGET,
  DEFAULT_REALITY_LIMIT, DEFAULT_EVIDENCE_TIMEOUT_MS,
  RAGFLOW_DATASET_IDS, RETRIEVAL_LIMITS, COMPOSITION_BUDGET_PCT,
  CHANNEL_MIN_ITEMS, DEFAULT_STYLE_QUERIES, DEFAULT_MATERIAL_DISCOVERY_QUERIES, RANDOM_DISCOVERY_SEEDS,
  type RetrievalLimits,
} from '../config';
import { buildWriterPrompt } from '../agents/prompts/writing/writer-prompt.mjs';
import { callStormResearch } from '../tools/storm/storm-client.ts';
import type { StormResearchResult } from '../contracts.ts';
import { deriveSourceAttribution, type SourceAttribution } from '../context/source-authority.ts';
import { buildSections, serializeItem } from '../context/writer-context.ts';
import {
  buildCorpusDiagnostics,
  buildRealityDiagnostics,
  buildStormDiagnostics,
  computeFulltextRatio,
  countChannels,
  countCharsByChannel,
} from '../context/context-diagnostics.ts';
import type { ContextEngineRequest, ContextEngineResult, ContextItem, ContextProgressEvent } from './types.ts';
export type { ContextEngineRequest, ContextEngineResult, ContextItem, ContextProgressEvent } from './types.ts';
import {
  buildEvidenceQueries,
  extractKeySources,
  normalizeWebQueries,
} from '../tools/database/evidence-query.ts';
export { buildEvidenceQueries } from '../tools/database/evidence-query.ts';
import {
  buildPreview,
  dedupeStrings,
  normalizeText,
  readBoolean,
  readNumber,
  readObject,
  readOptionalPositiveInteger,
  softTimeout,
  splitTerms,
} from './text-utils.ts';
export { stormQuestionsToKeywordQueries } from '../tools/storm/storm-query.ts';
import { stormQuestionsToKeywordQueries } from '../tools/storm/storm-query.ts';

// Prompt 文本已经收敛到 agents/prompts/；context-builder 只负责召回、预算裁剪和装箱。
// 结构判断和审查任务不在这里预先干预正文形状。
//
// 文件地图：
// - buildArticleContextEngine：总编排。只准备材料和 prompt，不写正文。
// - loadEvidencePack / normalizeEvidencePackChunks：事实证据通道 [REALITY]。
// - loadCorpusItems / normalize*：写法、词库、结构、作者偏好等非事实通道。
// - composeByBudget：按预算装箱。
// - context/source-authority.ts：来源归属和事实主体权限。
// - context/writer-context.ts：把 packed materials 变成 Writer 可读上下文。
// - context/context-diagnostics.ts：召回/装箱诊断摘要。
// - helpers：去重、超时和 query 处理。

export async function buildArticleContextEngine(input: {
  request: ContextEngineRequest;
  topic: string;
  targetWordCount: number;
  onProgress?: (event: ContextProgressEvent) => void;
}): Promise<ContextEngineResult> {
  // 上下文构建主流程。
  // 对照 generateArticle() 看：generateArticle() 第 3 步会进到这里。
  // 这个函数只负责“生成前准备材料和 prompt”，不负责写正文。
  //
  // 工具调用顺序大体是：
  //   1. research query expansion，把主题拆成检索 query；
  //   2. DataBase Gateway EvidencePack，拿事实证据；
  //   3. DataBase Gateway corpus/style/vector，拿词汇、风格、作者画像和语料块；
  //   4. association expansion，补关联材料；
  //   5. 本地排序、去重、过滤、装箱，生成最终 Writer prompt。
  const reportProgress = createContextProgressReporter(input.onProgress);
  const warnings: string[] = [];
  const query = readContextQuery(input.request, input.topic);

  // 第 0 步：打开本地语料库（data/writer-engine.sqlite）。
  // 事实资料、文学范文、词库都从这里检索；项目不依赖任何外部数据库或网关。
  const gateway = new LocalCorpus();
  const evidenceRequired = isEvidenceRequired(input.request);

  const contextTokenBudget = computeContextTokenBudget(input.request);
  const contextCharBudget = readNumber(
    input.request.contextCharBudget || input.request.settings?.contextCharBudget,
    Math.min(DEFAULT_CONTEXT_CHAR_BUDGET, Math.floor(contextTokenBudget * 3.2)),
  );

  // 题材不设限：不再探测体裁，所有题材共用同一套通用检索上限。
  const retrievalLimits = RETRIEVAL_LIMITS;

  // 第 1 步：STORM 研究规划 + 检索查询编排。
  // STORM 只负责给出研究视角、问题和提纲；它不覆盖 EvidencePack 的事实权威。
  const target = input.request.target || input.request.goal || '';
  const stormConfig = getStormResearchConfig();
  reportProgress('context_storm', 'Calling STORM research planner');
  const stormTimeoutMs = readOptionalPositiveInteger(input.request.stormTimeoutMs || input.request.settings?.stormTimeoutMs)
    ?? stormConfig.timeoutMs;
  let stormResult: StormResearchResult | null = null;
  let stormError = '';
  try {
    stormResult = await softTimeout(
      callStormResearch({ topic: input.topic, target }),
      stormTimeoutMs,
      () => { stormError = `timed out after ${stormTimeoutMs}ms`; },
      null,
    );
  } catch (error) {
    stormError = error instanceof Error ? error.message : String(error);
  }
  if (stormConfig.required && !stormResult) {
    throw new Error(`STORM required: research planner did not return a usable result${stormError ? ` (${stormError})` : ''}`);
  }
  reportProgress('context_storm_done', stormResult ? `STORM returned ${stormResult.questions?.length || 0} questions` : `STORM degraded${stormError ? `: ${stormError}` : ''}`);
  if (!stormResult) {
    warnings.push(stormConfig.enabled
      ? `storm: degraded${stormError ? ` (${stormError})` : ''}`
      : 'storm: disabled');
  }

  reportProgress('context_query_expansion', 'Expanding research queries');
  const researchQueries = await expandResearchQueries(input.topic, target);
  const stormQueries = stormResult?.questions?.length
    ? stormQuestionsToKeywordQueries(stormResult.questions)
    : [];
  const expandedQueries = dedupeStrings([...stormQueries, ...researchQueries]).slice(0, 12);
  if (expandedQueries.length) {
    warnings.push(stormResult
      ? `storm: ${stormResult.perspectives?.length || 0} perspectives, ${expandedQueries.length} queries, outline ${String(stormResult.outline || '').length}chars`
      : `pre-research: expanded into ${expandedQueries.length} queries`);
  }

  // 第 2 步：调用 DataBase Gateway 的 EvidencePack。
  // 这是最重要的事实证据入口。
  // 这里会把主题 query、webQueries、keySources、RAGFlow datasetIds 等交给 DataBase Gateway；
  // DataBase Gateway 再决定如何组合私有库、RAGFlow、web search 等来源。
  // 这一步失败或返回空 Reality 时，生成应当失败，不允许 Writer 凭空写。
  reportProgress('context_evidence', 'Loading EvidencePack from local corpus');
  const evidencePack = await loadEvidencePack({
    gateway,
    query,
    request: {
      ...input.request,
      webQueries: buildEvidenceQueries(input.request, expandedQueries),
    },
    warnings,
    realityLimit: retrievalLimits.reality,
  });
  if (evidenceRequired) {
    assertEvidencePack(evidencePack);
  } else if (!Array.isArray(evidencePack?.chunks) || !evidencePack.chunks.length) {
    // 本地语料里没有相关事实资料：记录告警后继续，由 Writer 基于设定和上下文创作。
    warnings.push('evidence: local corpus returned no reality chunks; continuing without factual evidence');
  }
  const evidenceItems = normalizeEvidencePackChunks(evidencePack);
  reportProgress('context_evidence_done', `EvidencePack loaded chunks=${evidenceItems.length}`);

  // 第 3 步：调用 DataBase Gateway 的辅助 corpus 接口。
  // 包括 RAGFlow 词库、style contract、author profile、article structure、vector batch。
  // 这些材料帮助写法、语义、作者气质和文风，但不能覆盖 EvidencePack 的事实边界。
  reportProgress('context_corpus', 'Loading corpus context from local corpus');
  const corpusItems = await loadCorpusItems({
    gateway,
    query,
    request: input.request,
    limits: retrievalLimits,
  });
  reportProgress('context_corpus_done', `Corpus context loaded items=${corpusItems.length}`);

  // 第 4 步：association expansion。
  // 作用：根据主题扩一些关联概念，再用 DataBase Gateway vector search 找补充材料。
  // 边界：它是“研究提示/联想层”，不是事实权威。
  // 失败策略：超时就跳过，不阻断生成。
  reportProgress('context_association', 'Expanding association context');
  const associationTimeoutMs = readOptionalPositiveInteger(input.request.associationTimeoutMs || input.request.settings?.associationTimeoutMs)
    ?? readOptionalPositiveInteger(process.env.CONTENTBASE_ASSOCIATION_TIMEOUT_MS)
    ?? 45_000;
  const associationItems = await softTimeout(
    associationExpand(input.topic, gateway),
    associationTimeoutMs,
    () => warnings.push(`association: timed out after ${associationTimeoutMs}ms; skipped optional association context`),
  );
  if (associationItems.length) {
    warnings.push(`association: expanded ${associationItems.length} items from LLM-generated terms`);
  }
  reportProgress('context_association_done', `Association context loaded items=${associationItems.length}`);

  const stormItems = normalizeStormItems(stormResult);

  const contextItems = [
    ...evidenceItems,
    ...corpusItems,
    ...associationItems,
    ...stormItems,
  ].map(normalizeContextItem);
  if (!contextItems.length) {
    if (evidenceRequired) {
      throw new Error('Reality required: EvidencePack returned zero usable Reality chunks');
    }
    warnings.push('context: no corpus material matched; writing from the request alone');
  }

  // 第 5 步：合并后的材料排序、去重。
  // ContentBase 不再直连外部 embedding rerank；检索质量排序归 DataBase Gateway。
  reportProgress('context_compose', `Composing context items=${contextItems.length}`);
  const stageCountsRaw = countChannels(contextItems);
  const ranked = rankAndDedupe(contextItems, input.topic, input.request);
  const stageCountsRanked = countChannels(ranked);
  const reranked = ranked;
  const stageCountsReranked = countChannels(reranked);

  // 第 6 步：污染过滤、多样性注入、按预算装箱。
  // contaminationFilter 防止非事实层材料污染 Reality；
  // composeByBudget 根据上下文预算挑最终进入 prompt 的材料。
  const filtered = contaminationFilter(reranked);
  const stageCountsFiltered = countChannels(filtered);
  const diverse = injectDiversity(filtered);
  const stageCountsDiverse = countChannels(diverse);
  const packed = composeByBudget({
    items: diverse,
    charBudget: contextCharBudget,
  });
  if (!packed.items.length && evidenceRequired) {
    throw new Error('Corpus Context required: packed context is empty');
  }
  const packedCounts = countChannels(packed.items);
  const packedChars = countCharsByChannel(packed.items);
  if ((packedCounts.reality || 0) < 1 && !evidenceRequired) {
    warnings.push('context: no reality material in packed context; facts come from the request only');
  } else if ((packedCounts.reality || 0) < 1) {
    throw new Error(`Reality required: zero Reality items survived context packing. Stage trace: evidence=${evidenceItems.length}(reality:${stageCountsRaw.reality||0}), ranked=${ranked.length}(reality:${stageCountsRanked.reality||0}), reranked=${reranked.length}(reality:${stageCountsReranked.reality||0}), filtered=${filtered.length}(reality:${stageCountsFiltered.reality||0}), diverse=${diverse.length}(reality:${stageCountsDiverse.reality||0}), packed=${packed.items.length}(reality:${packedCounts.reality||0}), charBudget=${contextCharBudget}`);
  }

  // 第 7 步：Reality 覆盖检查。
  // 这是给 Writer 上保险：事实证据不够，就别生成长文。
  assertRealityCoverage({
    request: input.request,
    packedCounts,
    packedChars,
    packedItems: packed.items,
    evidenceItems,
    stageTrace: `evidence=${evidenceItems.length}(reality:${stageCountsRaw.reality||0}), ranked=${ranked.length}(reality:${stageCountsRanked.reality||0}), reranked=${reranked.length}(reality:${stageCountsReranked.reality||0}), filtered=${filtered.length}(reality:${stageCountsFiltered.reality||0}), diverse=${diverse.length}(reality:${stageCountsDiverse.reality||0}), packed=${packed.items.length}(reality:${packedCounts.reality||0}), charBudget=${contextCharBudget}`,
  });
  if ((packedChars.reality || 0) < 500) {
    warnings.push('Reality thin: packed Reality < 500 chars, Writer output should stay narrow');
  }

  // 第 8 步：生成最终 Writer prompt。
  // 这里会把 Reality、Literary、Semantic、Author、Structure 等分区写进 prompt。
  // Writer 后面只拿这个 prompt 写正文。
  const prompt = buildWriterPrompt({
    request: input.request,
    topic: input.topic,
    targetWordCount: input.targetWordCount,
    contextTokenBudget,
    contextChars: packed.contextChars,
    packedItems: packed.items,
    sections: packed.sections,
  });
  reportProgress('context_done', `Article context ready chars=${packed.contextChars}`);

  return {
    prompt,
    sections: packed.sections,
    warnings,
    evidencePack,
    diagnostics: {
      query,
      contextTokenBudget,
      contextCharBudget,
      contextChars: packed.contextChars,
      counts: countChannels(contextItems),
      packedCounts,
      charsByChannel: packedChars,
      reality: buildRealityDiagnostics(contextItems.filter((item) => item.channel === 'reality'), packed.items.filter((item) => item.channel === 'reality')),
      corpus: buildCorpusDiagnostics(contextItems, packed.items),
      storm: buildStormDiagnostics(stormResult, stormError),
      audit: {
        reality: { loaded: true, chars: packedChars.reality || 0, sources: packedCounts.reality || 0, fulltext_ratio: computeFulltextRatio(packed.items.filter((i) => i.channel === 'reality')) },
        literary: { loaded: (packedCounts.literary || 0) > 0, units: packedCounts.literary || 0, chars: packedChars.literary || 0 },
        semantic: { loaded: (packedCounts.semantic || 0) > 0, units: packedCounts.semantic || 0, chars: packedChars.semantic || 0 },
        lexicon: { loaded: (packedCounts.lexicon || 0) > 0, units: packedCounts.lexicon || 0, chars: packedChars.lexicon || 0 },
        structure: { loaded: (packedCounts.structure || 0) > 0, patterns: packedCounts.structure || 0 },
        author: { loaded: (packedCounts.author || 0) > 0, chars: packedChars.author || 0 },
        composition: {
          order: ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author'].filter((ch) => (packedCounts[ch] || 0) > 0),
          truncated: ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author'].filter((ch) => (countChannels(contextItems)[ch] || 0) > (packedCounts[ch] || 0)),
          retrievalTags: countRetrievalTags(packed.items),
        },
      },
      items: packed.items.map((item, index) => ({
        id: `context_${index + 1}`,
        channel: item.channel,
        title: item.title,
        url: item.url,
        source: item.source,
        provenance: item.provenance,
        metadata: item.metadata,
        preview: buildPreview(item.text, 300),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Corpus loading: 非事实材料入口。ContentBase 只调 Gateway，不直连 RAGFlow/MySQL/Letta。
// ---------------------------------------------------------------------------

async function loadCorpusItems(input: {
  gateway: LocalCorpus;
  query: string;
  request: ContextEngineRequest;
  limits: RetrievalLimits;
}): Promise<ContextItem[]> {
  const evidenceQuery = readObject(input.request.evidenceQuery);
  if (evidenceQuery.requireCorpus === false || input.request.requireCorpus === false) {
    return [];
  }
  // [LEXICON] 只来自 RAGFlow author-lexicon 向量库；不再直灌 MySQL 词表或 style-contract 词表。
  const [vectorVocabulary, corpusContract, authorProfile, articleStructure] = await Promise.all([
    loadVectorVocabulary(input.gateway, input.query, input.limits.lexicon),
    input.gateway.getJson('/creative/style-contract', { protocol: String(evidenceQuery.protocol || input.request.protocol || 'immersive_historical_synthetic_narrative') }, 'corpus contract', [], DEFAULT_EVIDENCE_TIMEOUT_MS),
    input.gateway.getJson('/creative/author-profile', {}, 'author corpus', [], DEFAULT_EVIDENCE_TIMEOUT_MS),
    input.gateway.getJson('/creative/article-structure', {
      topic: input.query,
      target: String(input.request.target || input.request.goal || input.request.coreQuestion || ''),
      protocol: String(evidenceQuery.protocol || input.request.protocol || 'immersive_historical_synthetic_narrative'),
      semanticLimit: '8',
    }, 'article structure corpus', [], DEFAULT_EVIDENCE_TIMEOUT_MS),
  ]);
  const batchItems = await loadBatchVectorSearch(input.gateway, input.query);
  return [
    ...normalizeVectorVocabularyItems(vectorVocabulary),
    ...normalizeCorpusContract(corpusContract),
    ...normalizeAuthorProfile(authorProfile),
    ...normalizeArticleStructure(articleStructure),
    ...batchItems,
  ];
}

async function loadVectorVocabulary(gateway: LocalCorpus, query: string, limit: number): Promise<Record<string, any>> {
  // 专用词库向量入口。Gateway 侧只查 DATABASE_LEXICON_RAGFLOW_DATASET_IDS。
  try {
    return await gateway.getJson('/vocabulary/vector-search', {
      q: query,
      query,
      limit: String(limit),
    }, 'lexicon vector corpus', [], DEFAULT_EVIDENCE_TIMEOUT_MS);
  } catch {
    // 词库是风格增强项；接口未部署或超时时降级为空，不阻断事实生成。
    return {};
  }
}

function classifyByDocName(docName: string, item?: Record<string, any>): ContextItem['channel'] {
  const channel = String(item?.corpus_channel || item?.corpusChannel || item?.metadata?.corpusChannel || '').trim().toLowerCase();
  if (channel === 'lexicon') return 'lexicon';
  if (channel === 'literary') return 'literary';
  const sourceTable = String(item?.source_table || item?.sourceTable || item?.metadata?.sourceTable || '').trim().toLowerCase();
  if (sourceTable.includes('author_lexicon') || sourceTable.includes('vocabulary')) return 'lexicon';
  if (docName.startsWith('S_')) return 'semantic';
  if (docName.startsWith('B_') || docName.startsWith('C_') || docName.startsWith('D_')) return 'reality';
  return 'literary';
}

function normalizeContextItem(item: ContextItem): ContextItem {
  const metadata = readObject(item.metadata);
  const provenance = readObject(item.provenance);
  const sourceSystem = String(
    provenance.sourceSystem
    || metadata.sourceSystem
    || metadata.provider
    || ''
  ).trim();
  const sourceTable = String(
    provenance.sourceTable
    || metadata.sourceTable
    || metadata.source_table
    || ''
  ).trim();
  const sourceId = String(
    provenance.sourceId
    || metadata.sourceId
    || metadata.source_id
    || ''
  ).trim();
  const datasetId = String(
    provenance.datasetId
    || metadata.datasetId
    || metadata.dataset_id
    || ''
  ).trim();
  const documentId = String(
    provenance.documentId
    || metadata.documentId
    || metadata.document_id
    || ''
  ).trim();
  const score = Number(item.score ?? metadata.score ?? metadata.vectorScore ?? 0);
  const tags = Array.isArray(item.tags)
    ? item.tags.map(String).filter(Boolean)
    : Array.isArray(metadata.tags)
      ? metadata.tags.map(String).filter(Boolean)
      : [];
  const originTruth = String(
    provenance.originTruth
    || metadata.originTruth
    || inferOriginTruth({ channel: item.channel, sourceSystem, sourceTable, datasetId })
  ).trim();

  return {
    ...item,
    provenance: {
      ...(sourceSystem ? { sourceSystem } : {}),
      ...(sourceTable ? { sourceTable } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(datasetId ? { datasetId } : {}),
      ...(documentId ? { documentId } : {}),
      ...(originTruth ? { originTruth } : {}),
    },
    score: Number.isFinite(score) && score > 0 ? score : undefined,
    tags: tags.length ? tags : undefined,
    metadata: {
      ...metadata,
      ...(sourceSystem ? { sourceSystem } : {}),
      ...(sourceTable ? { sourceTable } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(datasetId ? { datasetId } : {}),
      ...(documentId ? { documentId } : {}),
      ...(originTruth ? { originTruth } : {}),
      ...(Number.isFinite(score) && score > 0 ? { score } : {}),
      ...(tags.length ? { tags } : {}),
    },
  };
}

function inferOriginTruth(input: {
  channel: ContextItem['channel'];
  sourceSystem: string;
  sourceTable: string;
  datasetId: string;
}): string {
  const hay = `${input.sourceSystem}\n${input.sourceTable}\n${input.datasetId}`.toLowerCase();
  if (input.channel === 'lexicon' && (hay.includes('ragflow') || hay.includes('author_lexicon'))) {
    return 'mysql.vocabulary.ragflow_projection';
  }
  if (input.channel === 'lexicon') return 'mysql.vocabulary';
  if (input.channel === 'literary' && hay.includes('ragflow')) return 'ragflow.literary_corpus';
  if (input.channel === 'reality' && hay.includes('ragflow')) return 'ragflow.evidence_corpus';
  if (input.channel === 'reality') return 'database.evidence_pack';
  if (input.channel === 'structure') return 'contentbase.structure_contract';
  if (input.channel === 'author') return 'database.author_profile';
  return `contentbase.${input.channel}`;
}

async function loadBatchVectorSearch(gateway: LocalCorpus, query: string): Promise<ContextItem[]> {
  // 非 Reality 资料池检索：常驻文风、材料组织、主题补充和随机发现并行进入。
  // 这里只扩大资料种类，不把检索种子变成正文写法规则。
  const envQueries = String(process.env.CONTENTBASE_STYLE_QUERIES || '').trim();
  const residentQueries = envQueries
    ? envQueries.split('|').map((q: string) => q.trim()).filter(Boolean)
    : DEFAULT_STYLE_QUERIES;
  const materialEnvQueries = String(process.env.CONTENTBASE_MATERIAL_DISCOVERY_QUERIES || '').trim();
  const materialQueries = materialEnvQueries
    ? materialEnvQueries.split('|').map((q: string) => q.trim()).filter(Boolean)
    : DEFAULT_MATERIAL_DISCOVERY_QUERIES;
  const seed = RANDOM_DISCOVERY_SEEDS[Math.floor(Math.random() * RANDOM_DISCOVERY_SEEDS.length)];
  const queryVariants = buildMaterialQueryVariants(query);

  const queries: { q: string; limit: number; tag: string }[] = [
    ...residentQueries.slice(0, 10).map(q => ({ q, limit: 2, tag: 'resident' })),
    ...materialQueries.slice(0, 8).map(q => ({ q, limit: 2, tag: 'material' })),
    { q: seed, limit: 3, tag: 'discovery' },
    ...queryVariants.map((q, index) => ({ q, limit: index === 0 ? 8 : 4, tag: index === 0 ? 'topic' : 'topic_variant' })),
  ];

  try {
    const data = await gateway.searchVectorBatch<{ results: { query: string; tag?: string; items: { document_name: string; chunk_text: string; score: number; document_id: string }[] }[] }>(queries, DEFAULT_EVIDENCE_TIMEOUT_MS);
    const items: ContextItem[] = [];
    for (const group of data.results || []) {
      for (const item of group.items || []) {
        if (!item.chunk_text || item.chunk_text.length < 60) continue;
        const channel = classifyByDocName(item.document_name, item);
        items.push({
          channel,
          title: item.document_name || undefined,
          source: `batch-vector/${group.tag || 'unknown'}/${item.document_id}`,
          text: item.chunk_text.slice(0, 800),
          priority: group.tag === 'topic' ? 130 : group.tag === 'resident' ? 145 : 120,
          provenance: {
            sourceSystem: 'database-gateway',
            sourceTable: (item as any).source_table,
            sourceId: (item as any).document_id,
            datasetId: (item as any).dataset_id,
            documentId: (item as any).document_id,
            originTruth: channel === 'lexicon' ? 'mysql.vocabulary.ragflow_projection' : 'ragflow.literary_corpus',
          },
          score: item.score,
          metadata: {
            provider: `database.batch_vector.${group.tag}`,
            retrievalTag: group.tag || 'unknown',
            retrievalQuery: group.query || undefined,
            score: item.score,
            sourceTable: (item as any).source_table,
            datasetId: (item as any).dataset_id,
            corpusChannel: (item as any).corpus_channel,
          },
        });
      }
    }
    return items;
  } catch { return []; }
}

function buildMaterialQueryVariants(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const variants = [
    normalized,
    `${normalized} 史料`,
    `${normalized} 制度`,
    `${normalized} 结构`,
    `${normalized} 文风`,
  ];
  return dedupeStrings(variants).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Evidence loading: 事实证据入口。这里要求 EvidencePack 可用，失败会阻断生成。
// ---------------------------------------------------------------------------

async function loadEvidencePack(input: {
  gateway: LocalCorpus;
  query: string;
  request: ContextEngineRequest;
  warnings: string[];
  realityLimit: number;
}): Promise<Record<string, any>> {
  const evidenceQuery = readObject(input.request.evidenceQuery);
  if (shouldSkipEvidenceSearch(input.request)) {
    throw new Error('Reality required: evidence search was disabled for article generation');
  }
  const datasetIds = Array.isArray(evidenceQuery.ragflowDatasetIds)
    ? evidenceQuery.ragflowDatasetIds.map(String).filter(Boolean)
    : [...RAGFLOW_DATASET_IDS];
  // 题材不设限：证据轮次/web/timeout 不再按体裁分支，统一用通用默认值。
  // rounds=8、includeWeb/persistWeb=true 是事实证据的通用打底默认。
  const params: Record<string, string> = {
    q: input.query,
    query: input.query,
    topic: String(input.request.topic || input.request.title || input.request.target || '').trim(),
    target: String(input.request.target || input.request.topic || input.request.title || '').trim(),
    limit: String(readNumber(evidenceQuery.perQueryLimit || evidenceQuery.limit || input.request.evidenceLimit, input.realityLimit)),
    rounds: String(readNumber(evidenceQuery.rounds || input.request.evidenceRounds, 8)),
    includeWeb: String(readBoolean(evidenceQuery.includeWeb ?? input.request.includeWebEvidence, true)),
    includeRagflow: String(readBoolean(evidenceQuery.includeRagflow ?? input.request.includeRagflowEvidence, true)),
    persistWeb: String(readBoolean(evidenceQuery.persistWeb ?? input.request.persistWebEvidence, true)),
  };
  const webQueries = normalizeWebQueries(evidenceQuery.webQueries || input.request.webQueries);
  if (webQueries.length) {
    const boundedWebQueries = boundEvidenceWebQueries(webQueries);
    if (boundedWebQueries.length) {
      params.webQueries = boundedWebQueries.join('\n');
    }
  }
  return input.gateway.searchEvidence(
    params,
    datasetIds,
    readOptionalPositiveInteger(evidenceQuery.evidenceTimeoutMs || evidenceQuery.timeoutMs)
      ?? DEFAULT_EVIDENCE_TIMEOUT_MS,
  );
}

function boundEvidenceWebQueries(queries: string[]): string[] {
  const maxQueries = 6;
  const maxChars = 320;
  const bounded: string[] = [];
  let total = 0;
  for (const item of queries.map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (bounded.length >= maxQueries) break;
    const clipped = item.slice(0, 80);
    const nextTotal = total + clipped.length + (bounded.length ? 1 : 0);
    if (nextTotal > maxChars) break;
    bounded.push(clipped);
    total = nextTotal;
  }
  return bounded;
}

function shouldSkipEvidenceSearch(request: ContextEngineRequest): boolean {
  const evidenceQuery = readObject(request.evidenceQuery);
  const settings = readObject(request.settings);
  return evidenceQuery.enabled === false
    || evidenceQuery.evidenceSearch === false
    || evidenceQuery.skipEvidenceSearch === true
    || request.evidenceSearch === false
    || request.skipEvidenceSearch === true
    || settings.evidenceSearch === false
    || settings.skipEvidenceSearch === true;
}

export function assertRealityCoverage(input: {
  request: ContextEngineRequest;
  packedCounts: Record<string, number>;
  packedChars: Record<string, number>;
  packedItems: ContextItem[];
  evidenceItems: ContextItem[];
  stageTrace: string;
}) {
  const realityCount = Number(input.packedCounts.reality || 0);
  const realityChars = Number(input.packedChars.reality || 0);
  const keySources = extractKeySources(input.request);
  // 题材不设限：覆盖检查不再按体裁分支。只在调用方显式给出 keySources 时统一校验，
  // 确认这些指定来源真的进入了打包后的 Reality；没有 keySources 时不强制。
  if (!keySources.length) return;

  const minimumRealityItems = readOptionalPositiveInteger(input.request.evidenceQuery?.minPackedRealityItems || input.request.minPackedRealityItems) ?? 6;
  const minimumRealityChars = readOptionalPositiveInteger(input.request.evidenceQuery?.minPackedRealityChars || input.request.minPackedRealityChars) ?? 8000;
  const matchedSources = matchKeySourcesInItems(keySources, input.packedItems.filter((item) => item.channel === 'reality'));
  const minimumMatchedSources = Math.min(
    keySources.length,
    readOptionalPositiveInteger(input.request.evidenceQuery?.minMatchedKeySources || input.request.minMatchedKeySources) ?? Math.min(3, keySources.length),
  );

  const failures: string[] = [];
  if (realityCount < minimumRealityItems) failures.push(`packed Reality items ${realityCount} < ${minimumRealityItems}`);
  if (realityChars < minimumRealityChars) failures.push(`packed Reality chars ${realityChars} < ${minimumRealityChars}`);
  if (matchedSources.length < minimumMatchedSources) {
    failures.push(`matched keySources ${matchedSources.length}/${keySources.length} < ${minimumMatchedSources}; missing=${keySources.filter((source) => !matchedSources.includes(source)).join('|')}`);
  }
  if (failures.length) {
    throw new Error(`Reality evidence contract failed: ${failures.join('; ')}. Stage trace: ${input.stageTrace}`);
  }
}

function assertEvidencePack(pack: Record<string, any>) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('Reality required: EvidencePack is missing');
  }
  const queryRun = readObject(pack.queryRun);
  const screening = readObject(pack.screening);
  const sources = Array.isArray(pack.sources) ? pack.sources : [];
  const chunks = Array.isArray(pack.chunks) ? pack.chunks : [];
  const citations = Array.isArray(pack.citations) ? pack.citations : [];
  const rounds = Array.isArray(queryRun.rounds) ? queryRun.rounds : [];
  if (!queryRun.provider || rounds.length < 1) {
    throw new Error('Reality required: EvidencePack queryRun is missing');
  }
  if (!screening.version && Number(screening.queryCount || 0) < 1) {
    throw new Error('Reality required: EvidencePack screening is missing');
  }
  if (sources.length < 1 || chunks.length < 1 || citations.length < 1) {
    throw new Error('Reality required: EvidencePack sources/chunks/citations are incomplete');
  }
}

// ---------------------------------------------------------------------------
// Evidence normalization and source attribution: 把 EvidencePack 压成 ContextItem。
// ---------------------------------------------------------------------------

function matchKeySourcesInItems(keySources: string[], items: ContextItem[]): string[] {
  const haystackByItem = items.map((item) => [
    item.title,
    item.source,
    item.url,
    item.text,
    item.provenance?.sourceId,
    item.provenance?.documentId,
    item.provenance?.datasetId,
  ].filter(Boolean).join('\n').toLowerCase());
  return keySources.filter((source) => {
    const needle = source.toLowerCase();
    return haystackByItem.some((haystack) => haystack.includes(needle));
  });
}

function normalizeEvidencePackChunks(payload: Record<string, any>): ContextItem[] {
  const sources = new Map<string, Record<string, any>>();
  const packProviders = readEvidencePackProviders(payload);
  const packProvider = packProviders.find((provider) => provider === 'ragflow.retrieval')
    || packProviders.find((provider) => provider)
    || '';
  for (const source of Array.isArray(payload.sources) ? payload.sources : []) {
    if (source && typeof source === 'object') {
      const id = String(source.id || source.sourceId || '').trim();
      if (id) sources.set(id, source);
    }
  }
  return (Array.isArray(payload.chunks) ? payload.chunks : []).map((chunk: any, index: number): ContextItem | undefined => {
    if (!chunk || typeof chunk !== 'object') return undefined;
    const text = String(chunk.text || chunk.fullText || chunk.content || chunk.body || chunk.snippet || chunk.excerpt || '').trim();
    if (!text) return undefined;
    const source = sources.get(String(chunk.sourceId || '').trim()) || {};
    // source.metadata 与 chunk.metadata 都保留；chunk 侧通常更靠近具体片段。
    const metadata = {
      ...readObject(source.metadata),
      ...readObject(chunk.metadata),
    };
    const provider = String(
      metadata.provider
      || chunk.provider
      || source.provider
      || packProvider
      || '',
    ).trim();
    const title = String(source.title || chunk.title || chunk.sourceTitle || '').trim() || undefined;
    const sourceId = String(chunk.sourceId || source.sourceId || source.id || '').trim() || undefined;
    const chunkId = String(
      chunk.id
      || chunk.chunkId
      || chunk.chunk_id
      || chunk.segmentId
      || chunk.segment_id
      || chunk.location?.chunkId
      || chunk.location?.chunkIndex
      || chunk.location?.index
      || index,
    ).trim();
    const url = String(
      chunk.location?.url
      || metadata.url
      || source.source
      || source.externalRefs?.find?.((item: any) => item?.url)?.url
      || '',
    ).trim() || undefined;
    const attribution = deriveSourceAttribution({
      title,
      source,
      chunk,
      metadata,
    });
    return {
      channel: classifyCorpusChannel({
        chunk,
        source,
        metadata: {
          ...metadata,
          provider,
          evidencePackProviders: packProviders,
        },
        text,
        title,
        sourceId,
      }),
      title,
      url,
      source: sourceId,
      text,
      priority: Number(chunk.relevanceScore || metadata.sourceQualityScore || 0) || undefined,
      provenance: {
        sourceSystem: provider || 'database-gateway',
        sourceTable: String(source.sourceTable || metadata.sourceTable || metadata.source_table || '').trim() || undefined,
        sourceId,
        datasetId: String(source.datasetId || metadata.datasetId || metadata.dataset_id || '').trim() || undefined,
        documentId: String(chunk.documentId || metadata.documentId || metadata.document_id || '').trim() || undefined,
        originTruth: provider.startsWith('ragflow') ? 'ragflow.evidence_corpus' : 'database.evidence_pack',
      },
      metadata: {
        ...metadata,
        provider: provider || 'database.evidence_pack',
        evidencePackProviders: packProviders,
        sourceType: source.sourceType,
        sourceTable: source.sourceTable,
        sourceId: source.sourceId || sourceId,
        evidenceChunkId: chunkId,
        relevanceScore: chunk.relevanceScore,
        ...attribution,
      },
    };
  }).filter(Boolean) as ContextItem[];
}

function readEvidencePackProviders(payload: Record<string, any>): string[] {
  const providers = new Set<string>();
  const queryRun = readObject(payload.queryRun);
  const addProvider = (value: unknown) => {
    const provider = String(value || '').trim().toLowerCase();
    if (provider) providers.add(provider);
  };
  addProvider(queryRun.provider);
  for (const round of Array.isArray(queryRun.rounds) ? queryRun.rounds : []) {
    if (round && typeof round === 'object') {
      addProvider((round as Record<string, any>).provider);
    }
  }
  return [...providers];
}

// ---------------------------------------------------------------------------
// Corpus normalization: 非事实通道统一转成 ContextItem，并标明只能作写法/结构线索。
// ---------------------------------------------------------------------------

function normalizeVectorVocabularyItems(payload: Record<string, any>): ContextItem[] {
  const rawItems = flattenVectorVocabularyItems(payload);
  return rawItems.map((item: any): ContextItem | undefined => {
    const text = String(
      item.text
      || item.chunk_text
      || item.content
      || item.term
      || item.value
      || ''
    ).trim();
    if (!text) return undefined;
    const id = String(item.id || item.document_id || item.chunk_id || item.source_id || '').trim();
    const title = String(item.title || item.document_name || item.category || item.type || 'vector vocabulary').trim();
    const sourceTable = String(item.source_table || item.sourceTable || item.metadata?.sourceTable || 'author_lexicon').trim();
    const datasetId = String(item.dataset_id || item.datasetId || item.metadata?.datasetId || '').trim();
    return {
      channel: 'lexicon',
      title,
      source: id ? `vocabulary-vector:${id}` : 'vocabulary-vector',
      text: [
        '向量词库命中：',
        text.slice(0, 1200),
        item.type ? `类型：${item.type}` : '',
        item.category ? `类别：${item.category}` : '',
        item.note ? `说明：${item.note}` : '',
      ].filter(Boolean).join('\n'),
      priority: 125,
      provenance: {
        sourceSystem: 'database-gateway',
        sourceTable,
        sourceId: id || undefined,
        datasetId: datasetId || undefined,
        documentId: id || undefined,
        originTruth: 'ragflow.author_lexicon',
      },
      score: Number(item.score || item.vectorScore || 0) || undefined,
      metadata: {
        provider: 'database.vocabulary_vector',
        sourceTable,
        datasetId: datasetId || undefined,
        corpusChannel: 'lexicon',
        score: Number(item.score || item.vectorScore || 0) || undefined,
      },
    };
  }).filter(Boolean) as ContextItem[];
}

function normalizeStormItems(result: StormResearchResult | null): ContextItem[] {
  if (!result) return [];
  const items: ContextItem[] = [];
  const outline = String(result.outline || '').trim();
  if (outline) {
    items.push({
      channel: 'structure',
      title: 'STORM Research Outline',
      source: 'storm/outline',
      text: outline.slice(0, 2000),
      priority: 200,
      provenance: {
        sourceSystem: 'storm',
        sourceTable: 'storm_outline',
        originTruth: 'storm.research_plan',
      },
      metadata: { provider: 'storm.outline', factAuthority: false },
    });
  }
  for (const cite of (result.citations || []).slice(0, 8)) {
    const snippet = String(cite?.snippet || '').trim();
    if (snippet.length < 60) continue;
    items.push({
      channel: 'reality',
      title: String(cite.title || '').trim() || undefined,
      source: `storm-citation/${String(cite.url || '').trim()}`,
      url: String(cite.url || '').trim() || undefined,
      text: snippet.slice(0, 1200),
      priority: 170,
      provenance: {
        sourceSystem: 'storm',
        sourceTable: 'storm_citation',
        sourceId: String(cite.url || '').trim() || undefined,
        originTruth: 'storm.citation',
      },
      score: Number(cite.score || 0),
      metadata: { provider: 'storm.citation', score: Number(cite.score || 0), sourceTier: 'S', factAuthority: 'candidate' },
    });
  }
  return items;
}

function flattenVectorVocabularyItems(payload: Record<string, any>): any[] {
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) {
    return payload.results.flatMap((group: any) => Array.isArray(group?.items) ? group.items : []);
  }
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data?.results)) {
    return payload.data.results.flatMap((group: any) => Array.isArray(group?.items) ? group.items : []);
  }
  return [];
}

function normalizeCorpusContract(payload: Record<string, any>): ContextItem[] {
  const items: ContextItem[] = [];
  for (const [channel, key] of [
    ['structure', 'modules'],
    ['structure', 'editingSteps'],
    ['structure', 'qualityRules'],
    ['literary', 'sourceMaterials'],
    ['author', 'authorTechniques'],
  ] as Array<[ContextItem['channel'], string]>) {
    const values = Array.isArray(payload[key]) ? payload[key] : [];
    if (!values.length) continue;
    items.push({
      channel,
      title: `DataBase corpus contract ${key}`,
      source: 'creative/style-contract',
      text: values.map(formatUnknownRecord).join('\n'),
      priority: 105,
      metadata: { provider: 'database.corpus_contract', part: key },
    });
  }
  return items;
}

function normalizeAuthorProfile(payload: Record<string, any>): ContextItem[] {
  const parts = [
    readObject(payload.profile),
    ...(Array.isArray(payload.interestClusters) ? payload.interestClusters : []),
    ...(Array.isArray(payload.authorTechniques) ? payload.authorTechniques : []),
  ];
  const text = parts.map(formatUnknownRecord).filter(Boolean).join('\n');
  if (!text) return [];
  return [{
    channel: 'author',
    title: 'DataBase author corpus',
    source: 'creative/author-profile',
    text,
    priority: 115,
    metadata: { provider: 'database.author_profile' },
  }];
}

function normalizeArticleStructure(payload: Record<string, any>): ContextItem[] {
  const thesis = readObject(payload.thesis);
  const authorMemory = readObject(payload.authorMemory);
  const lettaMemory = readObject(authorMemory.letta);
  const stylePressure = readObject(payload.stylePressure);
  const lettaCore = Array.isArray(lettaMemory.core)
    ? lettaMemory.core.map((item: any) => {
      const record = readObject(item);
      return [record.label, record.value].map(String).filter(Boolean).join('：');
    }).filter(Boolean)
    : [];
  const lettaArchival = Array.isArray(lettaMemory.archival)
    ? lettaMemory.archival.map((item: any) => String(readObject(item).text || '').trim()).filter(Boolean)
    : [];
  const text = [
    payload.role ? `结构层角色：${payload.role}` : '结构层角色：storm-structure-layer',
    thesis.motherQuestion ? `母题问题：${thesis.motherQuestion}` : '',
    thesis.subQuestion ? `子问题：${thesis.subQuestion}` : '',
    thesis.antithesis ? `事实张力：${thesis.antithesis}` : '',
    Array.isArray(thesis.axes) && thesis.axes.length ? `分析坐标：${thesis.axes.map(String).join('；')}` : '',
    Array.isArray(payload.researchQuestions) && payload.researchQuestions.length ? `研究问题：${payload.researchQuestions.map(String).join('；')}` : '',
    Array.isArray(payload.articleSpine) && payload.articleSpine.length ? `全文腹稿：${payload.articleSpine.map(String).join('；')}` : '',
    authorMemory.stance ? `作者立场记忆：${authorMemory.stance}` : '',
    Array.isArray(authorMemory.interestTerms) && authorMemory.interestTerms.length ? `长期兴趣词：${authorMemory.interestTerms.map(String).join('；')}` : '',
    lettaCore.length ? `Letta核心记忆：${lettaCore.join('；')}` : '',
    lettaArchival.length ? `Letta归档记忆：${lettaArchival.join('；')}` : '',
    Array.isArray(payload.semanticBrief) && payload.semanticBrief.length ? `语义提示：${payload.semanticBrief.map(String).join('；')}` : '',
    Array.isArray(stylePressure.qualityRules) && stylePressure.qualityRules.length ? `质量压力：${stylePressure.qualityRules.map(String).join('；')}` : '',
  ].filter(Boolean).join('\n');
  if (!text.trim()) return [];
  return [{
    channel: 'structure',
    title: 'DataBase article structure plan',
    source: 'creative/article-structure',
    text,
    priority: 150,
    provenance: {
      sourceSystem: 'database-gateway',
      sourceTable: 'creative.article_structure',
      originTruth: 'database.creative.article_structure',
    },
    metadata: {
      provider: String(payload.provider || 'database.creative.article_structure'),
      role: String(payload.role || 'storm-structure-layer'),
      counts: readObject(payload.counts),
      lettaStatus: String(lettaMemory.status || 'absent'),
    },
  }];
}


function classifyMaterialKind(value: string): ContextItem['channel'] | undefined {
  const normalized = value.toLowerCase();
  if (!normalized) return undefined;
  if (/lexical|vocab|禁用|词/.test(normalized)) return 'lexicon';
  if (/sentence|句式/.test(normalized)) return 'structure';
  if (/image|imagery|movement|典故|意象|运动/.test(normalized)) return 'semantic';
  if (/literary|literature|poetry|prose|novel|文学|小说|诗/.test(normalized)) return 'literary';
  return 'semantic';
}

function readSemanticMaterialKind(tags: unknown): string {
  const parsed = typeof tags === 'string' ? safeJsonArray(tags) : Array.isArray(tags) ? tags : [];
  for (const tag of parsed) {
    const value = String(tag?.value || tag?.tag_value || '').trim();
    if (value.startsWith('reference:')) return value.replace(/^reference:/, '');
  }
  return '';
}

function safeJsonArray(value: string): any[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatUnknownRecord(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, any>;
    const primary = record.content || record.term || record.word || record.name || record.title || record.id || '';
    const secondary = record.ruleText || record.description || record.note || record.rule || record.reason || record.text || '';
    const extra = [
      record.category ? `[${record.category}]` : '',
      record.severity === 'block' ? '[必须遵守]' : '',
      record.replacement ? `→${record.replacement}` : '',
    ].filter(Boolean).join(' ');
    return [primary, secondary, extra].map((item) => String(item || '').trim()).filter(Boolean).join(' - ') || JSON.stringify(record);
  }
  return String(value || '').trim();
}





// ---------------------------------------------------------------------------
// Composition: 清洗、去重、排序、按通道预算装箱。
// ---------------------------------------------------------------------------

function contaminationFilter(items: ContextItem[]): ContextItem[] {
  return items.filter((item) => {
    const text = item.text.toLowerCase();
    const title = (item.title || '').toLowerCase();
    const url = (item.url || '').toLowerCase();
    if (item.text.length < 15) return false;
    if (/^(首页|导航|关于我们|联系方式|copyright|all rights|cookie|privacy policy)/i.test(item.text)) return false;
    if (/seo|广告|推广|点击这里|免费领取|限时优惠/.test(text)) return false;
    if (/(百家号|搜狐号|头条号|企鹅号)/.test(title + url)) return false;
    if (item.channel === 'reality' && item.text.length < 40 && !/\d/.test(item.text)) return false;
    return true;
  });
}

function injectDiversity(items: ContextItem[]): ContextItem[] {
  const channelSeen = new Map<string, Set<string>>();
  const result: ContextItem[] = [];
  for (const item of items) {
    const ch = item.channel;
    if (!channelSeen.has(ch)) channelSeen.set(ch, new Set());
    const seen = channelSeen.get(ch)!;
    const sourceKey = String(item.source || item.title || '').trim().toLowerCase().slice(0, 60);
    const sameSourceCount = [...seen].filter((k) => k === sourceKey).length;
    if (sameSourceCount >= 5) continue;
    seen.add(sourceKey);
    result.push(item);
  }
  return result;
}




function composeByBudget(input: {
  items: ContextItem[];
  charBudget: number;
}) {
  const hardBudget = Math.max(1000, Math.floor(input.charBudget));
  // 题材不设限：通道预算比例不再按体裁切换，统一用 COMPOSITION_BUDGET_PCT。
  const budgetPct = COMPOSITION_BUDGET_PCT;
  const channels: ContextItem['channel'][] = ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author'];
  const channelBudgets = Object.fromEntries(
    channels.map((ch) => [ch, Math.floor(hardBudget * (budgetPct[ch] || 10) / 100)])
  );
  const channelItems = Object.fromEntries(channels.map((ch) => [ch, [] as ContextItem[]]));
  const channelUsed = Object.fromEntries(channels.map((ch) => [ch, 0]));
  const packedKeys = new Set<string>();
  let totalUsed = 0;

  const pushPackedItem = (item: ContextItem, itemBudget: number): boolean => {
    const ch = item.channel;
    const normalized = { ...item, text: normalizeText(item.text) };
    if (!normalized.text) return false;
    const key = dedupeKey(normalized);
    if (packedKeys.has(key)) return false;
    const remainingTotal = hardBudget - totalUsed;
    if (remainingTotal <= 0) return false;
    const fitted = fitItemToBudget(normalized, Math.min(itemBudget, remainingTotal));
    if (!fitted) return false;
    const serialized = serializeItem(fitted, 1);
    if (serialized.length > remainingTotal) return false;
    channelItems[ch].push(fitted);
    channelUsed[ch] += serialized.length;
    totalUsed += serialized.length;
    packedKeys.add(key);
    return true;
  };

  // Pass 1: 先保底通道多样性，避免某个强相关通道把其它通道挤空。
  const itemsByChannel = Object.fromEntries(channels.map((ch) => [ch, [] as ContextItem[]]));
  for (const item of input.items) {
    const normalized = { ...item, text: normalizeText(item.text) };
    if (!normalized.text) continue;
    itemsByChannel[item.channel]?.push(normalized);
  }
  for (const ch of channels) {
    const minItems = CHANNEL_MIN_ITEMS[ch] || 2;
    const available = itemsByChannel[ch];
    for (let i = 0; i < Math.min(minItems, available.length); i++) {
      const item = available[i];
      const perItemBudget = Math.max(240, Math.floor((channelBudgets[ch] || hardBudget) / Math.max(minItems, 1)));
      pushPackedItem(item, perItemBudget);
    }
  }

  // Pass 2: 各通道在自己的预算内继续填充。
  for (const item of input.items) {
    const ch = item.channel;
    const remainingChannel = (channelBudgets[ch] || 0) - (channelUsed[ch] || 0);
    if (remainingChannel <= 0) continue;
    pushPackedItem(item, remainingChannel);
  }

  let packed = channels.flatMap((ch) => channelItems[ch]);

  // Pass 3: 如果总预算还很空，再允许任意通道溢出补位。
  if (totalUsed < hardBudget * 0.85) {
    for (const item of input.items) {
      pushPackedItem(item, hardBudget - totalUsed);
    }
    packed = channels.flatMap((ch) => channelItems[ch]);
  }

  return {
    items: packed,
    contextChars: packed.reduce((sum, item, index) => sum + serializeItem(item, index + 1).length, 0),
    sections: buildSections(packed),
  };
}

function fitItemToBudget(item: ContextItem, charBudget: number): ContextItem | null {
  const normalized = { ...item, text: normalizeText(item.text) };
  if (!normalized.text) return null;
  if (serializeItem(normalized, 1).length <= charBudget) return normalized;

  const marker = '\n[...truncated by context budget...]';
  const headerChars = serializeItem({ ...normalized, text: '' }, 1).length;
  const textBudget = Math.floor(charBudget - headerChars - marker.length);
  if (textBudget < 80) return null;
  return {
    ...normalized,
    text: `${normalized.text.slice(0, textBudget).trimEnd()}${marker}`,
  };
}

function createContextProgressReporter(onProgress?: (event: ContextProgressEvent) => void) {
  return (stage: string, message: string) => {
    if (typeof onProgress === 'function') {
      onProgress({ stage, message, at: new Date().toISOString() });
    }
  };
}

// Digest recalled author memory into a compact operating brief before the Writer sees it.
// Give the Writer a whole-article spine so long-form prose does not end on the last local evidence node.
export function rankAndDedupe(items: ContextItem[], topic: string, request: ContextEngineRequest = {}): ContextItem[] {
  let topicTerms: string[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jieba = require('jieba-wasm');
    topicTerms = (jieba.cut(topic, true) as string[]).filter((w: string) => w.trim().length >= 2);
  } catch {
    topicTerms = splitTerms(topic);
  }
  const taskFrame = buildTaskFrameTerms(topic, request, topicTerms);
  const seen = new Set<string>();
  return items
    .map((item) => {
      const scored = scoreItem(item, topicTerms, taskFrame);
      return {
        item: {
          ...item,
          metadata: {
            ...(item.metadata || {}),
            taskFrameHits: scored.taskFrameHits,
            topicHits: scored.topicHits,
            taskFrameRole: scored.taskFrameRole,
          },
        },
        score: scored.score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .filter(({ item }) => {
      const key = dedupeKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ item }) => item);
}

function scoreItem(item: ContextItem, topicTerms: string[], taskFrame: string[]): {
  score: number;
  topicHits: number;
  taskFrameHits: number;
  taskFrameRole: string;
} {
  const hay = `${item.title || ''}\n${item.source || ''}\n${item.url || ''}\n${item.text || ''}`.toLowerCase();
  // Base score from text length (cap at 60 to avoid huge items dominating)
  let score = Math.min(60, Math.floor(item.text.length / 200));
  score += readNumber(item.priority, 0);
  // Term match bonus - more weight per term hit
  let topicHits = 0;
  for (const term of topicTerms) {
    if (term && hay.includes(term.toLowerCase())) {
      score += 22;
      topicHits++;
    }
  }
  let taskFrameHits = 0;
  for (const term of taskFrame) {
    if (term && hay.includes(term.toLowerCase())) {
      taskFrameHits++;
    }
  }
  if (taskFrameHits >= 5) score += 55;
  else if (taskFrameHits >= 3) score += 34;
  else if (taskFrameHits >= 2) score += 18;
  else if (taskFrameHits === 0 && topicHits >= 2 && item.channel === 'reality') score -= 18;
  // Bonus for multiple term hits (indicates higher relevance)
  if (topicHits >= 3) score += 30;
  else if (topicHits >= 2) score += 15;
  // Literary corpus items with term hits get extra boost (style reference)
  if (item.channel === 'literary' && topicHits >= 1) score += 20;
  return {
    score,
    topicHits,
    taskFrameHits,
    taskFrameRole: classifyTaskFrameRole(topicHits, taskFrameHits),
  };
}

function buildTaskFrameTerms(topic: string, request: ContextEngineRequest, topicTerms: string[]): string[] {
  const structure = readObject(request.structure);
  const plan = readObject(request.episodePlan || request.plan || structure.episodePlan);
  const sourceText = [
    topic,
    request.title,
    request.target,
    request.goal,
    request.coreQuestion,
    request.thesisQuestion,
    request.motherQuestion,
    request.input,
    structure.title,
    structure.openingImage,
    structure.ending,
    structure.requirements,
    plan.title,
    plan.openingImage,
    plan.narrativeBeats,
    plan.ending,
    plan.requirements,
  ].map(formatTaskFrameValue).filter(Boolean).join('\n');
  const terms = [
    ...topicTerms,
    ...splitTerms(sourceText),
  ];
  return Array.from(new Set(
    terms
      .map((term) => String(term || '').trim())
      .filter((term) => term.length >= 2 && term.length <= 24)
      .filter((term) => !/^\d+$/.test(term))
  )).slice(0, 80);
}

function formatTaskFrameValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatTaskFrameValue).filter(Boolean).join('\n');
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(formatTaskFrameValue).filter(Boolean).join('\n');
  return String(value || '').trim();
}

function classifyTaskFrameRole(topicHits: number, taskFrameHits: number): string {
  if (taskFrameHits >= 3) return 'direct-frame-evidence';
  if (taskFrameHits >= 1) return 'supporting-frame-evidence';
  if (topicHits >= 2) return 'topic-only-tool-or-background';
  return 'weak-or-contextual';
}

// ---------------------------------------------------------------------------
// Classification and request parsing: 判断材料通道，并读取调用方传入的 query/budget。
// ---------------------------------------------------------------------------

function classifyCorpusChannel(input: {
  chunk: Record<string, any>;
  source: Record<string, any>;
  metadata: Record<string, any>;
  text: string;
  title?: string;
  sourceId?: string;
}): ContextItem['channel'] {
  const provider = String(input.metadata.provider || input.chunk.provider || input.source.provider || '').toLowerCase();
  const sourceTable = String(input.metadata.sourceTable || input.chunk.sourceTable || input.source.sourceTable || '').toLowerCase();
  const sourceId = String(input.sourceId || '').toLowerCase();

  // EvidencePack is the factual evidence endpoint. Its chunk source ids may still
  // carry semantic__/literary__ prefixes inherited from upstream retrieval, but
  // once DataBase Gateway has screened them into EvidencePack they must be
  // available to Reality; otherwise the writer gets one factual item and fills
  // the article with abstract explanation.
  const packProviders = Array.isArray(input.metadata.evidencePackProviders) ? input.metadata.evidencePackProviders : [];
  if (packProviders.length > 0 && !provider.includes('literature') && !provider.includes('literary')) {
    return 'reality';
  }

  // General RAGFlow corpus search is not automatically Reality: semantic/literary
  // datasets also come through RAGFlow, and promoting them to Reality pollutes Fact Agent.
  // The prefix checks below are for non-EvidencePack corpus materials only.
  if (provider === 'web.search' || sourceId.startsWith('web__')) return 'reality';
  if (sourceId.startsWith('semantic__') || sourceId.startsWith('sem_')) return 'semantic';
  if (sourceId.startsWith('literary__') || sourceId.startsWith('lit_')) return 'literary';
  if (sourceId.startsWith('lexicon__') || sourceId.startsWith('lex_')) return 'lexicon';
  if (sourceTable === 'search_chunks') return 'reality';

  const hay = [
    input.chunk.sourceProvider,
    input.chunk.sourceType,
    input.chunk.collection,
    input.chunk.datasetId,
    input.chunk.datasetName,
    input.source.sourceType,
    input.source.collection,
    input.source.datasetId,
    input.source.datasetName,
    input.metadata.sourceType,
    input.metadata.collection,
    input.metadata.collectionName,
    input.metadata.datasetId,
    input.metadata.datasetName,
    input.metadata.corpus,
    input.metadata.corpusType,
    input.metadata.channel,
    input.metadata.kind,
    input.metadata.tags,
    input.title,
    input.sourceId,
  ].map((item) => JSON.stringify(item || '')).join('\n').toLowerCase();

  if (/(lexical|vocab|vocabulary|banned|preferred|forbidden|禁用|偏好|词库|词表)/i.test(hay)) {
    return 'lexicon';
  }
  if (/(semantic|worldview|unit|语义|世界观|兴亡的世界史|苏美|吉尔伽美什|文明模型|要素还原)/i.test(hay)) {
    return 'semantic';
  }
  if (/(structure|composition|outline|narrative form|结构|章法|篇章|材料组织|叙述组织)/i.test(hay)) {
    return 'structure';
  }
  if (/(imagery|image|movement|典故|意象|物象|运动)/i.test(hay)) {
    return 'semantic';
  }
  if (/(literary|literature|poetry|novel|prose|文学|诗|小说|散文)/i.test(hay)) {
    return 'literary';
  }
  return 'reality';
}

function readContextQuery(request: ContextEngineRequest, topic: string): string {
  const evidenceQuery = readObject(request.evidenceQuery);
  return String(evidenceQuery.query || request.searchQuery || request.query || topic).trim() || topic;
}

function computeContextTokenBudget(request: ContextEngineRequest): number {
  const explicit = request.contextTokenBudget || request.settings?.contextTokenBudget;
  if (explicit && Number(explicit) > 0) return Math.min(Number(explicit), 120000);
  const model = getContextWindowModel(request.model);
  const window = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_MODEL_CONTEXT_WINDOW;
  const usable = Math.floor(window * CONTEXT_UTILIZATION_RATIO) - SYSTEM_PROMPT_RESERVE - OUTPUT_TOKEN_RESERVE;
  return Math.max(20000, Math.min(usable, 120000));
}

// ---------------------------------------------------------------------------
// Generic helpers: 只做宽松读取、超时保护、切词和去重。
// ---------------------------------------------------------------------------

function dedupeKey(item: ContextItem): string {
  if (item.channel === 'reality' && isEvidenceChunkItem(item)) {
    const sourceId = String(item.provenance?.sourceId || item.metadata?.sourceId || item.source || '').trim().toLowerCase();
    const documentId = String(item.provenance?.documentId || item.metadata?.documentId || '').trim().toLowerCase();
    const chunkId = String(item.metadata?.evidenceChunkId || '').trim().toLowerCase();
    if (sourceId || documentId || chunkId) {
      return `evidence-chunk:${sourceId}:${documentId}:${chunkId}:${normalizeText(item.text).slice(0, 80).toLowerCase()}`;
    }
  }
  const url = String(item.url || '').trim().toLowerCase().replace(/[?#].*$/, '');
  if (url) return `url:${url}`;
  return normalizeText(`${item.channel}\n${item.title || ''}\n${item.text || ''}`).slice(0, 280).toLowerCase();
}

function countRetrievalTags(items: ContextItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const tag = String(item.metadata?.retrievalTag || item.metadata?.provider || item.provenance?.sourceSystem || item.channel || 'unknown');
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function isEvidenceChunkItem(item: ContextItem): boolean {
  const provider = String(item.metadata?.provider || item.provenance?.sourceSystem || '').toLowerCase();
  const originTruth = String(item.metadata?.originTruth || item.provenance?.originTruth || '').toLowerCase();
  const sourceTable = String(item.metadata?.sourceTable || item.provenance?.sourceTable || '').toLowerCase();
  const packProviders = Array.isArray(item.metadata?.evidencePackProviders)
    ? item.metadata?.evidencePackProviders.map(String).join('\n').toLowerCase()
    : '';
  return provider.includes('evidence')
    || provider.startsWith('ragflow')
    || originTruth.includes('evidence')
    || sourceTable === 'search_chunks'
    || packProviders.includes('ragflow')
    || packProviders.includes('evidence');
}

// ---------------------------------------------------------------------------
// Optional expansion: 用外部模型扩展研究/联想 query，失败时静默降级为空。
// ---------------------------------------------------------------------------

async function associationExpand(topic: string, gateway: LocalCorpus): Promise<ContextItem[]> {
  const { baseUrl, apiKey, model } = getAssociationModelService();
  if (!baseUrl || !apiKey) return [];

  let terms: string[] = [];
  try {
    const payload = await requestJson<Record<string, any>>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages: [
          { role: 'system', content: '输出一个JSON字符串数组，5-8项。每项是一个短语（2-6个中文字）。要求：给定主题的跳跃式联想，指向隐藏的历史、制度、文化或地缘连接。只输出["词1","词2",...]，不要任何解释。' },
          { role: 'user', content: topic },
        ],
        temperature: 0.7,
        max_tokens: 300,
      },
      timeoutMs: 15000,
      label: 'association expansion',
    });
    const text = String(payload?.choices?.[0]?.message?.content || '').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    terms = parsed.map(String).filter((t: string) => t.length >= 2 && t.length <= 40).slice(0, 8);
  } catch {
    return [];
  }
  if (!terms.length) return [];

  const items: ContextItem[] = [];
  const fetches = terms.map(async (term) => {
    try {
      const payload = await gateway.searchVector({ q: term, limit: '2' }, 'association expand', 8000);
      const results = Array.isArray(payload.results) ? payload.results : [];
      for (const result of results) {
        const text = String(result.snippet || result.chunk_text || result.content || '').trim();
        if (!text || text.length < 80) continue;
        const score = Number(result.score || result.similarity || 0);
        items.push({
          channel: 'structure',
          title: String(result.title || result.source || '').trim() || undefined,
          source: `association/${String(result.document_id || '').trim()}`,
          text: text.slice(0, 800),
          priority: 130,
          provenance: {
            sourceSystem: 'contentbase-association',
            sourceTable: String(result.source_table || '').trim() || undefined,
            sourceId: String(result.id || result.source_id || '').trim() || undefined,
            datasetId: String(result.dataset_id || '').trim() || undefined,
            documentId: String(result.document_id || '').trim() || undefined,
            originTruth: 'contentbase.association_expand.research_hint',
          },
          score,
          metadata: { provider: 'association_engine', layer: 'association', associationTerm: term, score, factAuthority: false },
        });
      }
    } catch { /* skip */ }
  });
  await Promise.all(fetches);
  return items;
}

async function expandResearchQueries(topic: string, target: string): Promise<string[]> {
  const { baseUrl, apiKey, model } = getResearchModelService();
  if (!baseUrl || !apiKey) return [];

  const prompt = `文章主题：${topic}${target ? `\n写作方向：${target}` : ''}

把这个主题拆成6-8个具体的搜索查询。要求：
- 中英文各半
- 每个查询针对一个具体的事实、人物、事件、年份、文献或数据
- 不要泛泛的概念词，要能搜到具体信息的查询
- 英文查询要用学术/百科风格的关键词组合
- 每行一个查询，不要编号，不要解释`;

  try {
    const payload = await requestJson<Record<string, any>>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages: [
          { role: 'system', content: '你是研究助手。只输出搜索查询列表，不输出其他内容。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      },
      timeoutMs: 12000,
      label: 'research query expansion',
    });
    const text = String(payload?.choices?.[0]?.message?.content || '');
    return text.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length >= 4 && line.length <= 80).slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * 事实证据是否为硬性要求。
 * 默认不强制：本地语料有命中就作为证据使用，没有命中就继续创作（小说写作的常态）。
 * 请求显式给出 keySources / evidenceQuery.required，或设置 WRITER_REQUIRE_EVIDENCE=1 时才强制。
 */
function isEvidenceRequired(request: ContextEngineRequest): boolean {
  const evidenceQuery = readObject(request.evidenceQuery);
  if (evidenceQuery.required === true || (request as Record<string, any>).requireEvidence === true) return true;
  if (extractKeySources(request).length) return true;
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.WRITER_REQUIRE_EVIDENCE || '').trim().toLowerCase());
}

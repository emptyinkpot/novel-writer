// 语料诊断源码：汇总 Gateway、Writer 等服务连通和语料状态。
// 诊断只暴露红acted状态，不泄露生产密钥。
import { databaseGatewayHeaders, getDatabaseGatewayService, getRuntimeEnvDiagnostics, getWriterServiceDiagnostics } from '../config/env.ts';

export async function corpusDiagnostics() {
  const gateway = getDatabaseGatewayService();
  const gatewayUrl = gateway.baseUrl;
  if (!gatewayUrl) {
    return { error: 'DATABASE_GATEWAY_URL not configured', channels: {} };
  }

  const headers = databaseGatewayHeaders(gateway);

  async function gw(path, label, timeoutMs = 15000) {
    try {
      const r = await fetch(`${gatewayUrl}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return { error: `${label}: HTTP ${r.status}` };
      return await r.json();
    } catch (e) {
      return { error: `${label}: ${e.message}` };
    }
  }

  const [tables, health, ragflow, litStats, semanticFull, vocabSample] = await Promise.all([
    gw('/inventory/tables', 'inventory'),
    gw('/health', 'health'),
    gw('/health/ragflow?retrieval=true&q=测试', 'ragflow', 8000),
    gw('/content/literature/stats', 'literature-stats'),
    gw('/semantic/units?search=&limit=300', 'semantic-full'),
    gw('/vocabulary/search?q=&limit=5', 'vocabulary-sample'),
  ]);

  const tableMap = {};
  if (Array.isArray(tables?.tables)) {
    for (const t of tables.tables) tableMap[t.name] = t;
  }

  const searchChunks = tableMap['search_chunks'] || {};
  const searchDocuments = tableMap['search_documents'] || {};
  const semanticUnitsTable = tableMap['semantic_units'] || {};
  const vocabTable = tableMap['vocabulary'] || {};
  const litTable = tableMap['literature'] || {};

  const litCount = litStats?.count || litTable.approximateRows || 0;
  const litTotalChars = litStats?.totalChars || 0;
  const litByCategory = litStats?.byCategory || {};
  const litCompleteness = litStats?.completeness || {};
  const litDuplicateRate = litStats?.duplicateRate || '0%';
  const litDuplicateTitles = litStats?.duplicateTitles || [];
  const litItems = Array.isArray(litStats?.items) ? litStats.items : [];

  const semItems = Array.isArray(semanticFull?.units) ? semanticFull.units : [];
  let semTotalChars = 0;
  const semByKind = {};
  for (const item of semItems) {
    const chars = (item.excerpt || '').length + (item.summary || '').length;
    semTotalChars += chars;
    const kind = item.materialKind || 'unknown';
    if (!semByKind[kind]) semByKind[kind] = { count: 0, chars: 0 };
    semByKind[kind].count++;
    semByKind[kind].chars += chars;
  }

  const vocabItems = Array.isArray(vocabSample?.results || vocabSample?.vocabulary) ? (vocabSample.results || vocabSample.vocabulary) : [];
  const vocabCount = vocabTable.approximateRows || 0;

  const docCount = searchDocuments.approximateRows || 0;
  const chunkCount = searchChunks.approximateRows || 0;
  const avgChunksPerDoc = docCount > 0 ? Math.round(chunkCount / docCount) : 0;

  const channels = {
    literary: {
      source: 'search_chunks + search/vector (RAGFlow)',
      documents: docCount,
      chunks: chunkCount,
      avgChunksPerDocument: avgChunksPerDoc,
      dataBytes: searchChunks.dataBytes || 0,
      dataMB: Math.round((searchChunks.dataBytes || 0) / 1048576),
      ragflowStatus: health?.optionalDownstreams?.ragflow || 'unknown',
      ragflowRetrieval: ragflow?.ok ? 'ok' : (ragflow?.error || 'unavailable'),
      ragflowChunks: ragflow?.chunkCount ?? null,
    },
    semantic: {
      source: 'semantic_units',
      units: semanticUnitsTable.approximateRows || 0,
      totalChars: semTotalChars,
      byMaterialKind: semByKind,
    },
    lexicon: {
      source: 'vocabulary + creative lexicon',
      terms: vocabTable.approximateRows || 0,
      dataBytes: vocabTable.dataBytes || 0,
    },
    structure: {
      source: 'creative_style_modules + editing_steps + quality_rules',
      modules: (tableMap['creative_style_modules'] || {}).approximateRows || 0,
      editingSteps: (tableMap['creative_editing_steps'] || {}).approximateRows || 0,
      qualityRules: (tableMap['creative_quality_rules'] || {}).approximateRows || 0,
    },
    author: {
      source: 'creative_author_techniques + author_interest_clusters',
      techniques: (tableMap['creative_author_techniques'] || {}).approximateRows || 0,
      interestClusters: (tableMap['author_interest_clusters'] || {}).approximateRows || 0,
    },
    reality: {
      source: 'evidence/search (web + ragflow retrieval)',
      note: 'dynamic per-query, not pre-indexed',
    },
  };

  const totalDataMB = Math.round(
    ((searchChunks.dataBytes || 0) + (semanticUnitsTable.dataBytes || 0) +
     (vocabTable.dataBytes || 0) + (litTable.dataBytes || 0)) / 1048576
  );

  return {
    generatedAt: new Date().toISOString(),
    gateway: {
      url: gatewayUrl,
      mysql: health?.checks?.mysql || 'unknown',
      ragflow: health?.optionalDownstreams?.ragflow || 'unknown',
    },
    summary: {
      totalDocuments: docCount,
      totalChunks: chunkCount,
      totalDataMB,
      literatureItems: litCount,
      literatureTotalChars: litTotalChars,
      semanticUnits: semanticUnitsTable.approximateRows || 0,
      semanticTotalChars: semTotalChars,
      vocabularyTerms: vocabCount,
    },
    quality: {
      duplication: {
        rate: litDuplicateRate,
        duplicateTitles: litDuplicateTitles,
      },
      completeness: {
        ragDocuments: docCount,
        ragChunks: chunkCount,
        avgChunksPerDocument: avgChunksPerDoc,
        literature: litCompleteness,
        semanticUnits: semItems.length,
        vocabularyTerms: vocabCount,
        semanticCoverage: semItems.length > 0 ? 'active' : 'empty',
        vocabularyCoverage: vocabItems.length > 0 ? 'active' : 'empty',
        structureModules: (tableMap['creative_style_modules'] || {}).approximateRows || 0,
        authorTechniques: (tableMap['creative_author_techniques'] || {}).approximateRows || 0,
      },
    },
    literature: {
      totalItems: litCount,
      totalChars: litTotalChars,
      byCategory: litByCategory,
      topItems: litItems.slice(0, 15),
    },
    channels,
    env: getRuntimeEnvDiagnostics(),
    writer: getWriterServiceDiagnostics(),
  };
}

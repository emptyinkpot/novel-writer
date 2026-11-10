import { getStormResearchConfig } from '../../config/env.ts';
import type { StormDiagnostics, StormResearchResult } from '../contracts.ts';
import type { ContextItem } from '../planning/types.ts';
import { serializeItem } from './writer-context.ts';

// Owner: context diagnostics.
// Boundary: builds read-only summaries for traces, logs, and release reports.
// It does not decide retrieval, packing, source authority, or prose content.

export function countChannels(items: ContextItem[]): Record<string, number> {
  return items.reduce((acc, item) => {
    acc[item.channel] = (acc[item.channel] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

export function countCharsByChannel(items: ContextItem[]): Record<string, number> {
  return items.reduce((acc, item, index) => {
    acc[item.channel] = (acc[item.channel] || 0) + serializeItem(item, index + 1).length;
    return acc;
  }, {} as Record<string, number>);
}

export function buildRealityDiagnostics(allItems: ContextItem[], packedItems: ContextItem[]) {
  const sourceTierCounts = packedItems.reduce((acc, item) => {
    const tier = String(item.metadata?.sourceTier || 'U');
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topSources = packedItems.slice(0, 20).map((item) => ({
    title: item.title,
    url: item.url,
    source: item.source,
    sourceTier: item.metadata?.sourceTier ? String(item.metadata.sourceTier) : undefined,
    fullTextChars: readNumber(item.metadata?.fullTextChars, 0),
  }));
  return {
    itemCount: allItems.length,
    packedItemCount: packedItems.length,
    chars: countCharsByChannel(packedItems).reality || 0,
    fullTextItemCount: packedItems.filter((item) => readNumber(item.metadata?.fullTextChars, 0) >= 1200).length,
    sourceTierCounts,
    topSources,
  };
}

export function computeFulltextRatio(items: ContextItem[]): number {
  if (!items.length) return 0;
  const fulltext = items.filter((item) => readNumber(item.metadata?.fullTextChars, 0) >= 1200).length;
  return Math.round((fulltext / items.length) * 100) / 100;
}

export function buildCorpusDiagnostics(allItems: ContextItem[], packedItems: ContextItem[]) {
  const allCounts = countChannels(allItems);
  const packedCounts = countChannels(packedItems);
  const packedChars = countCharsByChannel(packedItems);
  return Object.fromEntries(
    ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author'].map((channel) => [
      channel,
      {
        itemCount: Number(allCounts[channel] || 0),
        packedItemCount: Number(packedCounts[channel] || 0),
        chars: Number(packedChars[channel] || 0),
      },
    ]),
  );
}

export function buildStormDiagnostics(result: StormResearchResult | null, error = ''): StormDiagnostics {
  const config = getStormResearchConfig();
  const status = result
    ? 'ok'
    : (config.enabled ? (config.required ? 'failed' : 'degraded') : 'disabled');
  return {
    enabled: config.enabled,
    required: config.required,
    called: Boolean(result),
    status,
    error,
    perspectives: result?.perspectives?.length || 0,
    questions: result?.questions?.length || 0,
    outlineChars: String(result?.outline || '').length,
    citations: result?.citations?.length || 0,
  };
}

function readNumber(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

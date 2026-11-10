import type { ContextEngineRequest } from '../../planning/types.ts';
import { dedupeStrings, readObject } from '../../planning/text-utils.ts';

export function buildEvidenceQueries(request: ContextEngineRequest, expandedQueries: string[] = []): string[] {
  const evidenceQuery = readObject(request.evidenceQuery);
  const existing = [
    ...normalizeWebQueries(evidenceQuery.webQueries),
    ...normalizeWebQueries(request.webQueries),
  ];
  const keySources = extractKeySources(request);
  const sourceQueries = keySources.flatMap((source) => {
    const topic = String(request.topic || request.title || request.searchQuery || '').trim();
    return [
      source,
      topic ? `${source} ${topic}` : '',
    ];
  });
  return dedupeStrings([
    ...existing,
    ...sourceQueries,
    ...(expandedQueries.length ? expandedQueries : []),
  ]).slice(0, 24);
}

export function extractKeySources(request: ContextEngineRequest): string[] {
  const structure = readObject(request.structure);
  const plan = readObject(request.episodePlan || request.plan || structure.episodePlan);
  return normalizePlanStrings(plan.keySources || plan.sources || request.keySources || request.sources);
}

export function normalizeWebQueries(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeStrings(value.map(String));
  }
  if (typeof value === 'string') {
    return dedupeStrings(value.split(/[|｜\n\r]+/));
  }
  return [];
}

function normalizePlanStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeStrings(value.flatMap((item) => normalizePlanStrings(item)));
  }
  if (typeof value === 'object' && value !== null) {
    return dedupeStrings(Object.values(value as Record<string, unknown>).flatMap((item) => normalizePlanStrings(item)));
  }
  return String(value || '')
    .split(/[|｜;；,，、\n\r]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

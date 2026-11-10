// Owner: source authority inside article context.
// Boundary: decides whether a retrieved source can be named as an authored work
// in prose, and explains when a title is only a container/series/file name.
// It does not retrieve, rank, pack, serialize Writer context, or write prose.

export type SourceAttribution = {
  sourceAuthor?: string;
  sourceWorkTitle?: string;
  sourceContainerTitle?: string;
  sourceLocator?: string;
  attributionSubjectAllowed: boolean;
  attributionSubjectReason: string;
};

export function deriveSourceAttribution(input: {
  title?: string;
  source?: Record<string, any>;
  chunk?: Record<string, any>;
  metadata?: Record<string, any>;
}): SourceAttribution {
  const metadata = readObject(input.metadata);
  const source = readObject(input.source);
  const chunk = readObject(input.chunk);
  const rawTitle = String(
    metadata.sourceWorkTitle
    || metadata.workTitle
    || source.workTitle
    || chunk.workTitle
    || input.title
    || '',
  ).trim();
  const explicitAuthor = String(
    metadata.sourceAuthor
    || metadata.author
    || metadata.creator
    || source.author
    || source.creator
    || chunk.author
    || '',
  ).trim();
  const parsed = parseSourceTitle(rawTitle);
  const sourceAuthor = normalizeAttributionAuthor(explicitAuthor) || parsed.author || undefined;
  const sourceWorkTitle = String(metadata.sourceWorkTitle || parsed.workTitle || '').trim() || undefined;
  const sourceContainerTitle = String(metadata.sourceContainerTitle || parsed.containerTitle || '').trim() || undefined;
  const sourceLocator = String(
    metadata.sourceLocator
    || metadata.locator
    || chunk.page
    || chunk.pageNumber
    || chunk.location?.page
    || chunk.location?.position
    || '',
  ).trim() || undefined;
  const allowed = Boolean(sourceAuthor && sourceWorkTitle && !parsed.containerOnly);
  return {
    sourceAuthor,
    sourceWorkTitle,
    sourceContainerTitle,
    sourceLocator,
    attributionSubjectAllowed: allowed,
    attributionSubjectReason: allowed
      ? 'author-and-work-title-present'
      : parsed.containerOnly
        ? parsed.containerReason
        : sourceAuthor
          ? 'missing-work-title'
          : 'missing-author',
  };
}

function parseSourceTitle(title: string): {
  author?: string;
  workTitle?: string;
  containerTitle?: string;
  containerOnly: boolean;
  containerReason?: string;
} {
  const cleaned = String(title || '')
    .replace(/\.(?:txt|pdf|md|docx?)$/i, '')
    .replace(/^B_/, '')
    .trim();
  if (!cleaned) return { containerOnly: true, containerReason: 'empty-title' };
  const [leftRaw, rightRaw] = cleaned.split(/\s+--\s+/, 2);
  const left = String(leftRaw || '').trim();
  const right = String(rightRaw || '').trim();
  const author = extractAuthorFromTitleRight(right);
  const containerReason = getContainerLikeSourceTitleReason(left, author);
  const containerOnly = Boolean(containerReason);
  return {
    author,
    workTitle: containerOnly ? undefined : left || undefined,
    containerTitle: containerOnly ? left || undefined : undefined,
    containerOnly,
    containerReason,
  };
}

function getContainerLikeSourceTitleReason(title: string, author?: string): string | undefined {
  const text = String(title || '').trim();
  if (!text) return 'empty-title';
  if (/^(?:Baseline Article|Reference Article|Style Sample|Author Memory|Semantic Unit|sem_ref_|semantic__)/i.test(text)) {
    return 'internal-context-locator-only';
  }
  if (/\bT\d+\s*§\s*\d+\b/i.test(text)) {
    return 'internal-context-locator-only';
  }
  if (/(?:全\s*\d+\s*(?:卷|册)|合集|丛书|系列|选读|资料|材料|文集|全集|bookdoc|part-\d+)/i.test(text)) {
    return 'container-or-file-title-only';
  }
  const hasBookTitle = /《[^》]+》/.test(text);
  const hasChapterLocator = /(?:序章|总序|序言|前言|导论|绪论|概论|终章|结语|后记|第\s*[一二三四五六七八九十百千万\d]+\s*(?:章|节|部|篇|卷|册))/i.test(text);
  const hasSubworkMarker = /(?:卷名|册名|子书|分册|作者|著|编著|主编)/.test(text);
  if (hasBookTitle && hasChapterLocator && !author && !hasSubworkMarker) {
    return 'container-title-with-chapter-only';
  }
  return undefined;
}

function extractAuthorFromTitleRight(value: string): string | undefined {
  const cleaned = String(value || '')
    .replace(/\.(?:txt|pdf|md|docx?)$/i, '')
    .trim();
  if (!cleaned) return undefined;
  const first = cleaned.split(/[;；、,，]/).map((item) => item.trim()).filter(Boolean)[0];
  if (!first || /等$/.test(first) || /系列|合集|全\d|publisher|press|series|collection/i.test(first)) return undefined;
  return first;
}

function normalizeAttributionAuthor(value: string): string | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;
  if (/^(?:ContentMRS|ContentBase|RAGFlow|DataBase|Baseline|Semantic Unit)$/i.test(text)) return undefined;
  return text;
}

function readObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

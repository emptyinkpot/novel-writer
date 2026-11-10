import type { ContextItem } from '../planning/types.ts';

// Owner: Writer context projection.
// Boundary: converts already-packed ContextItem values into Writer-readable
// channel sections with explicit Reality/non-Reality authority labels.
// It does not retrieve, rank, pack, or decide source authority.

export function buildSections(items: ContextItem[]): Record<string, string> {
  const sections: Record<string, string> = {};
  for (const channel of ['reality', 'literary', 'semantic', 'lexicon', 'structure', 'author']) {
    sections[channel] = buildSection(items.filter((item) => item.channel === channel));
  }
  return sections;
}

export function serializeItem(item: ContextItem, index: number): string {
  const content = serializeItemContent(item);
  const attributionRestricted = item.metadata?.attributionSubjectAllowed === false;
  return [
    `材料 ${index}`,
    item.title ? `标题：${item.title}` : '',
    item.source ? `来源：${item.source}` : '',
    !attributionRestricted && item.metadata?.sourceAuthor ? `来源作者：${item.metadata.sourceAuthor}` : '',
    !attributionRestricted && item.metadata?.sourceWorkTitle ? `可归属作品：${item.metadata.sourceWorkTitle}` : '',
    item.metadata?.sourceContainerTitle ? `来源容器：${item.metadata.sourceContainerTitle}` : '',
    attributionRestricted && item.metadata?.sourceAuthor ? `受限来源容器署名：${item.metadata.sourceAuthor}` : '',
    attributionRestricted && item.metadata?.sourceWorkTitle ? `受限来源标题：${item.metadata.sourceWorkTitle}` : '',
    item.metadata?.sourceLocator ? `来源定位：${item.metadata.sourceLocator}` : '',
    item.metadata?.attributionSubjectAllowed === false ? `归属限制：不可把标题、作者、系列、出版社、文件名或数据集名当作观点主体；原因=${item.metadata.attributionSubjectReason || 'insufficient-attribution'}` : '',
    item.metadata?.taskFrameRole ? `任务框架匹配：${item.metadata.taskFrameRole}；任务命中=${item.metadata.taskFrameHits || 0}；主题命中=${item.metadata.topicHits || 0}` : '',
    item.provenance?.sourceSystem ? `来源系统：${item.provenance.sourceSystem}` : '',
    item.provenance?.sourceTable ? `来源表：${item.provenance.sourceTable}` : '',
    item.provenance?.datasetId ? `数据集：${item.provenance.datasetId}` : '',
    item.provenance?.originTruth ? `真源：${item.provenance.originTruth}` : '',
    item.url ? `链接：${item.url}` : '',
    content,
  ].filter(Boolean).join('\n');
}

function buildSection(items: ContextItem[]): string {
  return items
    .map((item, index) => serializeItem(item, index + 1))
    .join('\n\n');
}

function serializeItemContent(item: ContextItem): string {
  if (item.channel === 'reality') {
    return `内容：${item.text}`;
  }
  if (item.channel === 'literary') {
    return serializeLiteraryExemplar(item);
  }
  if (item.channel === 'semantic') {
    return [
      '非事实用途：只提供概念关系和解释方向；不得提供新增事实。',
      `概念线索：${summarizeNonRealityText(item.text)}`,
    ].join('\n');
  }
  if (item.channel === 'structure') {
    return [
      '非事实用途：只提供研究路线、问题提示或收束方向；不得提供正文事实。',
      `结构线索：${summarizeNonRealityText(item.text)}`,
    ].join('\n');
  }
  if (item.channel === 'author') {
    return [
      '非事实用途：只提供用户偏好、立场和风格边界；不得提供史实。',
      `作者线索：${summarizeNonRealityText(item.text)}`,
    ].join('\n');
  }
  return `非事实用途：偏好词和禁用词边界。\n词汇线索：${summarizeNonRealityText(item.text)}`;
}

function serializeLiteraryExemplar(item: ContextItem): string {
  return [
    '非事实用途：只学习叙述气息、语气温度、意象组织、材料取舍、段落呼吸、叙事开头和收束方式；不得复述其中人物、事件、年代、因果或场景。',
    '事实禁用：本段只作为范文摘录，不得把其中事实、数字、地点或判断迁移为本文事实。',
    `范文摘录：${normalizeText(item.text)}`,
  ].join('\n');
}

function summarizeNonRealityText(text: string): string {
  const normalized = normalizeText(text)
    .replace(/\b\d{3,4}\b/g, '[year]')
    .replace(/[0-9]+(?:\.[0-9]+)?%?/g, '[num]');
  const sentences = normalized
    .split(/(?<=[。！？.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const sample = sentences.slice(0, 3).join(' ');
  return (sample || normalized).slice(0, 360);
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

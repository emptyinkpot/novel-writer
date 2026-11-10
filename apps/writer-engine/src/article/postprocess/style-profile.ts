import { ABSTRACT_SUBJECT_PATTERN, hasConcreteAnchor } from './style-sensors.ts';
import type { StyleProfile, StyleViolation } from './types.ts';

export function buildStyleProfile(text: string, violations: StyleViolation[]): StyleProfile {
  const cleaned = text.trim();
  const chars = cleaned.length;
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sentences = cleaned.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  const sentenceLengths = sentences.map((s) => s.length).filter((n) => n > 0);
  const avgSentenceLength = average(sentenceLengths);
  const sentenceLengthStdDev = standardDeviation(sentenceLengths, avgSentenceLength);
  const longSentences = sentenceLengths.filter((n) => n >= 90).length;
  const shortParagraphs = paragraphs.filter((p) => p.length <= 45 && (p.match(/[。！？]/g) || []).length <= 1).length;
  const paragraphsWithConcreteAnchor = paragraphs.filter((p) => hasConcreteAnchor(p.slice(0, 180))).length;
  const abstractSubjectParagraphs = paragraphs.filter((p) => ABSTRACT_SUBJECT_PATTERN.test(p) && !hasConcreteAnchor(p.slice(0, 180))).length;
  const opening = paragraphs[0] || '';
  const connectiveRules = new Set(['ai_connective_zhuanzhe', 'ai_connective_yushici', 'ai_connective_pinglunqiang', 'ai_connective_shoucu', 'ai_connective_taoyu']);
  const connectiveCount = violations.filter((v) => connectiveRules.has(v.rule)).length;
  const severityWeight = { low: 1, medium: 2, high: 3 } as const;
  const weighted = violations.reduce((sum, v) => sum + severityWeight[v.severity || 'low'], 0);
  const perThousand = chars > 0 ? chars / 1000 : 1;
  return {
    chars,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    avgSentenceLength: round1(avgSentenceLength),
    sentenceLengthStdDev: round1(sentenceLengthStdDev),
    longSentenceRatio: round3(sentenceLengths.length ? longSentences / sentenceLengths.length : 0),
    shortParagraphRatio: round3(paragraphs.length ? shortParagraphs / paragraphs.length : 0),
    connectiveDensityPerThousand: round2(connectiveCount / perThousand),
    violationDensityPerThousand: round2(violations.length / perThousand),
    aiResidueScore: round2(weighted / perThousand),
    openingHasConcreteAnchor: opening ? hasConcreteAnchor(opening.slice(0, 180)) : false,
    openingAbstractSubject: opening ? ABSTRACT_SUBJECT_PATTERN.test(opening) && !hasConcreteAnchor(opening.slice(0, 180)) : false,
    concreteAnchorParagraphRatio: round3(paragraphs.length ? paragraphsWithConcreteAnchor / paragraphs.length : 0),
    abstractSubjectParagraphRatio: round3(paragraphs.length ? abstractSubjectParagraphs / paragraphs.length : 0),
  };
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], avg: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

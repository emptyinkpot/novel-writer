export interface PostProcessOptions {
  breakUniformParagraphs?: boolean;
  stripStructuralHeadings?: boolean;
  normalizeDislikedPunctuation?: boolean;
  dedupeRepeatedParagraphs?: boolean;
}

export type StyleViolation = {
  rule: string;
  pattern: string;
  match: string;
  category?: string;
  severity?: 'low' | 'medium' | 'high';
  advice?: string;
};

export type StyleProfile = {
  chars: number;
  paragraphs: number;
  sentences: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  longSentenceRatio: number;
  shortParagraphRatio: number;
  connectiveDensityPerThousand: number;
  violationDensityPerThousand: number;
  aiResidueScore: number;
  openingHasConcreteAnchor: boolean;
  openingAbstractSubject: boolean;
  concreteAnchorParagraphRatio: number;
  abstractSubjectParagraphRatio: number;
};

export type StylePattern = {
  rule: string;
  pattern: RegExp;
  category: string;
  severity: 'low' | 'medium' | 'high';
  advice: string;
};

import type { StormDiagnostics } from '../contracts.ts';

export type ContextEngineRequest = Record<string, any>;

export type ContextProgressEvent = {
  stage: string;
  message: string;
  at?: string;
};

export type ContextItem = {
  channel: 'reality' | 'literary' | 'semantic' | 'lexicon' | 'structure' | 'author';
  title?: string;
  url?: string;
  source?: string;
  text: string;
  priority?: number;
  provenance?: {
    sourceSystem?: string;
    sourceTable?: string;
    sourceId?: string;
    datasetId?: string;
    documentId?: string;
    originTruth?: string;
  };
  score?: number;
  tags?: string[];
  metadata?: Record<string, any>;
};

export type ContextEngineResult = {
  prompt: string;
  sections: Record<string, string>;
  warnings: string[];
  evidencePack: Record<string, any>;
  diagnostics: {
    query: string;
    contextTokenBudget: number;
    contextCharBudget: number;
    contextChars: number;
    counts: Record<string, number>;
    packedCounts: Record<string, number>;
    charsByChannel: Record<string, number>;
    reality: {
      itemCount: number;
      packedItemCount: number;
      chars: number;
      fullTextItemCount: number;
      sourceTierCounts: Record<string, number>;
      topSources: Array<{
        title?: string;
        url?: string;
        source?: string;
        sourceTier?: string;
        fullTextChars?: number;
      }>;
    };
    corpus: Record<string, {
      itemCount: number;
      packedItemCount: number;
      chars: number;
    }>;
    storm: StormDiagnostics;
    audit: {
      reality: { loaded: boolean; chars: number; sources: number; fulltext_ratio: number };
      literary: { loaded: boolean; units: number; chars: number };
      semantic: { loaded: boolean; units: number; chars: number };
      lexicon: { loaded: boolean; units: number; chars: number };
      structure: { loaded: boolean; patterns: number };
      author: { loaded: boolean; chars: number };
      composition: { order: string[]; truncated: string[]; retrievalTags?: Record<string, number> };
    };
    items: Array<{
      id: string;
      channel: string;
      title?: string;
      url?: string;
      source?: string;
      provenance?: ContextItem['provenance'];
      preview: string;
    }>;
  };
};

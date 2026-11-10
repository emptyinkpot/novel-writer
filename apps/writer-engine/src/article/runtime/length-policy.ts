import { measureArticleLength, type LengthWindow } from './length-window.ts';

export type LengthEvaluation = {
  stage: string;
  effective: number;
  minChars: number;
  maxChars: number;
  ok: boolean;
  reason: string;
};

/**
 * Single source of truth for article-length validation across the whole pipeline.
 *
 * Every length checkpoint (flow-level floor checks AND per-agent validators) must go
 * through here so they share ONE bound (the window min/max) and ONE measurement. The
 * previous code had three contradictory lower bounds (minChars, 0.82*orig, 0.84*orig)
 * evaluated against a mode-switching measurer, so whichever checkpoint sat closest to
 * the boundary on a given non-deterministic run was the one that threw — the pipeline
 * "shattered at a different point each run". The bound stays strict; it just stops
 * contradicting itself. "Don't shrink the article too much" is expressed through the
 * retry feedback, not through a second numeric band.
 */
export function evaluateLength(body: unknown, lengthWindow: LengthWindow, stage: string): LengthEvaluation {
  const effective = measureArticleLength(normalizeForMeasure(body));
  const { minChars, maxChars } = lengthWindow;
  let ok = true;
  let reason = '';
  if (effective < minChars) {
    ok = false;
    reason = `${stage}: ${effective} effective chars below floor ${minChars} (window ${minChars}-${maxChars})`;
  } else if (effective > maxChars) {
    ok = false;
    reason = `${stage}: ${effective} effective chars above ceiling ${maxChars} (window ${minChars}-${maxChars})`;
  }
  return { stage, effective, minChars, maxChars, ok, reason };
}

/**
 * Strip code fences and normalize whitespace before measuring, so the measured length
 * is stable across normalizeBody boundaries (agents strip fences before returning; the
 * flow re-measures the same text). Without this, a fence added/removed between a stage
 * exit and the next validator drifts the count and trips a boundary check spuriously.
 */
export function normalizeForMeasure(body: unknown): string {
  const source = String(body || '').trim();
  const fenced = source.match(/^```(?:markdown|md|text|json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : source).trim();
}

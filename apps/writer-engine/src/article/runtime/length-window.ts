export type LengthWindow = {
  targetChars: number;
  minChars: number;
  maxChars: number;
};

const LENGTH_WINDOW_TOLERANCE_RATIO = 0.125;
const LENGTH_WINDOW_MIN_TOLERANCE = 300;
const LENGTH_WINDOW_MAX_TOLERANCE = 1000;

export function resolveLengthWindow(targetWordCount: number): LengthWindow {
  const targetChars = Math.max(1, Math.floor(targetWordCount));
  const tolerance = Math.min(
    LENGTH_WINDOW_MAX_TOLERANCE,
    Math.max(LENGTH_WINDOW_MIN_TOLERANCE, Math.floor(targetChars * LENGTH_WINDOW_TOLERANCE_RATIO)),
  );
  return {
    targetChars,
    minChars: Math.max(1, targetChars - tolerance),
    maxChars: targetChars + tolerance,
  };
}

export function measureArticleLength(body: unknown): number {
  const text = String(body || '');
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const nonWhitespaceCount = text.replace(/\s/g, '').length;
  return cjkCount >= Math.ceil(nonWhitespaceCount * 0.45)
    ? cjkCount
    : nonWhitespaceCount;
}

export function readObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function readNumber(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function readBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
}

export function readOptionalPositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

export async function softTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void, fallback: T = [] as T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          onTimeout();
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (!timedOut && timeout) clearTimeout(timeout);
  }
}

export function splitTerms(value: string): string[] {
  return String(value || '')
    .split(/[\s,，。；;:：、|/\\()[\]{}"'“”‘’]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 24);
}

export function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function buildPreview(value: string, limit: number): string {
  const text = normalizeText(value);
  if (!text) return '';
  const half = Math.floor(text.length / 2);
  if (half >= 80 && text.slice(0, half) === text.slice(half, half * 2)) {
    return text.slice(0, Math.min(limit, half));
  }
  return text.slice(0, limit);
}

export function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

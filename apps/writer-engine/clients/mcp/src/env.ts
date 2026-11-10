import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadMcpEnv(): void {
  const root = process.env.CONTENTBASE_WORKSPACE_ROOT || resolve(__dirname, '..', '..', '..');
  loadEnvFile(resolve(root, '.env'));
  loadEnvFile(resolve(root, '.env.example'));
}

export function getContentBaseBaseUrl(): string {
  const value = process.env.CONTENTBASE_TEST_BASE_URL || process.env.CONTENTBASE_BASE_URL || '';
  return normalizeBaseUrl(value);
}

export function getContentBaseApiKey(): string {
  return String(process.env.CONTENTBASE_API_KEY || '').trim();
}

export function normalizeBaseUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!key || !value || value.startsWith('replace-with-')) continue;
    process.env[key] ||= value;
  }
}

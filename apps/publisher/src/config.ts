import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findRepoRoot, resolveDataDir } from './runtime/browser/local-store.mjs';

export interface FanqieServiceConfig {
  host: string;
  port: number;
  dataDir: string;
  rootDir: string;
  contentBaseRoot?: string;
  version: string;
}

export function loadConfig(): FanqieServiceConfig {
  const repoRoot = findRepoRoot();
  const rootEnv = join(repoRoot, '.env');
  if (existsSync(rootEnv)) {
    try {
      process.loadEnvFile(rootEnv);
    } catch {
      /* 格式错误时忽略，交给显式环境变量 */
    }
  }
  const rootDir = resolve(process.env.FANQIE_SERVICE_ROOT || resolve(repoRoot, 'apps/publisher'));
  return {
    host: process.env.FANQIE_SERVICE_HOST || '127.0.0.1',
    port: Number(process.env.FANQIE_SERVICE_PORT || 19202),
    dataDir: resolve(process.env.FANQIE_SERVICE_DATA_DIR || join(resolveDataDir(), 'publisher')),
    rootDir,
    contentBaseRoot: process.env.FANQIE_CONTENTBASE_ROOT ? resolve(process.env.FANQIE_CONTENTBASE_ROOT) : undefined,
    version: '0.1.0',
  };
}

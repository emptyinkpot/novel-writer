import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { resolve } from 'path';

// 项目只认识自己：所有外部依赖都通过环境变量注入，缺省时退回到仓库内的本地实现。
// 仓库根目录 = apps/api/{src,dist}/../../..
export const REPO_ROOT = resolve(__dirname, '../../..');

const rootEnv = resolve(REPO_ROOT, '.env');
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    /* 格式错误时忽略，交给显式环境变量 */
  }
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const DATA_DIR = resolve(optionalEnv('NOVEL_WRITER_DATA_DIR') ?? resolve(REPO_ROOT, 'data'));
mkdirSync(DATA_DIR, { recursive: true });

/** 设置了 DB_HOST 才连 MySQL，否则使用 data/ 下的 SQLite 文件。 */
export const USE_MYSQL = Boolean(optionalEnv('DB_HOST'));

export const columnTypes = {
  json: (USE_MYSQL ? 'json' : 'simple-json') as 'json',
  longText: (USE_MYSQL ? 'longtext' : 'text') as 'longtext',
};

/** JWT 密钥：优先读环境变量，否则在 data/ 下生成一次并持久化，重启后登录态不丢。 */
export function jwtSecret(): string {
  const fromEnv = optionalEnv('JWT_SECRET');
  if (fromEnv) return fromEnv;
  const file = resolve(DATA_DIR, '.jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** 模型接口：任意 OpenAI 兼容端点。兼容旧变量名 SUB2API_*。 */
export function llmConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = optionalEnv('LLM_BASE_URL') ?? optionalEnv('SUB2API_URL');
  const apiKey = optionalEnv('LLM_API_KEY') ?? optionalEnv('SUB2API_KEY');
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

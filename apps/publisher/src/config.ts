import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface FanqieServiceConfig {
  host: string;
  port: number;
  dataDir: string;
  rootDir: string;
  contentBaseRoot?: string;
  databaseGatewayUrl?: string;
  databaseGatewayApiKey?: string;
  version: string;
}

export function loadConfig(): FanqieServiceConfig {
  const rootDir = resolve(process.env.FANQIE_SERVICE_ROOT || process.cwd());
  loadDatabaseGatewayEnv(rootDir);
  const railwayPort = process.env.PORT;
  return {
    host: process.env.FANQIE_SERVICE_HOST || (railwayPort ? '0.0.0.0' : '127.0.0.1'),
    port: Number(process.env.FANQIE_SERVICE_PORT || railwayPort || 5701),
    dataDir: resolve(process.env.FANQIE_SERVICE_DATA_DIR || '.runtime/fanqie-service'),
    rootDir,
    contentBaseRoot: process.env.FANQIE_CONTENTBASE_ROOT ? resolve(process.env.FANQIE_CONTENTBASE_ROOT) : undefined,
    databaseGatewayUrl: process.env.DATABASE_GATEWAY_URL || process.env.FANQIE_DATABASE_GATEWAY_URL || 'https://database.example.invalid',
    databaseGatewayApiKey: process.env.DATABASE_GATEWAY_API_KEY || process.env.FANQIE_DATABASE_GATEWAY_API_KEY,
    version: '0.1.0',
  };
}

function loadDatabaseGatewayEnv(rootDir: string) {
  if (process.env.DATABASE_GATEWAY_URL || process.env.FANQIE_DATABASE_GATEWAY_URL) return;
  const projectConfig = readDatabaseProjectConfig(rootDir);
  const secretSurfaces = projectConfig && Array.isArray(projectConfig.secretSurfaces) ? projectConfig.secretSurfaces : [];
  for (const filePath of secretSurfaces) {
    if (!String(filePath).endsWith('.env')) continue;
    loadEnvFile(String(filePath));
    if (process.env.DATABASE_GATEWAY_URL || process.env.FANQIE_DATABASE_GATEWAY_URL) return;
  }
}

function readDatabaseProjectConfig(rootDir: string): any {
  const explicitRoot = process.env.DATABASE_PROJECT_ROOT || process.env.FANQIE_DATABASE_PROJECT_ROOT;
  const candidates = [
    explicitRoot ? resolve(explicitRoot, 'project.json') : '',
    resolve(rootDir, '..', 'DataBase', 'project.json'),
    resolve(dirname(rootDir), 'DataBase', 'project.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

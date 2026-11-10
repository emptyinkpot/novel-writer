import type BetterSqlite3 from 'better-sqlite3';

export type SqliteDb = BetterSqlite3.Database;

export interface LocalAccountRow {
  accountId: string;
  id: string;
  name: string | null;
  aliases: string[];
  status: string;
  cookieChecksum: string | null;
  cookiesStorageType: 'local';
  createdAt: string;
  updatedAt: string;
  session: {
    cookiesPayload: string | null;
    cookieCount: number | null;
    syncedAt: string | null;
    expiresSummary: Record<string, unknown> | null;
  };
}

export function findRepoRoot(start?: string): string;
export function resolveDataDir(): string;
export function openPublisherDb(file?: string): SqliteDb;
export function openLibraryDb(): SqliteDb | null;
export function listAccounts(db?: SqliteDb): LocalAccountRow[];
export function ensureAccount(accountId: string, info?: { name?: string; aliases?: string[] }, db?: SqliteDb): LocalAccountRow;
export function recordAccountSession(input: Record<string, unknown>, db?: SqliteDb): { accountId: string; syncedAt: string };
export function createRuntimeDatabaseClient(): {
  publication: {
    accounts(input?: Record<string, unknown>): Promise<{ accounts: LocalAccountRow[] }>;
    recordFanqieAccountSession(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ ok: true; item: unknown }>;
  };
};

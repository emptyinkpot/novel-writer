// publisher 的本地存储。项目只认识自己：账号、cookie、发布目标、发布记录都存在
// 仓库 data/ 目录下的 SQLite 里；待发布章节直接读 novel-writer 自己的作品库。
// TypeScript 服务（LocalPublicationStore）和浏览器 runtime 脚本共用这一份实现。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fanqie_accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  cookies_payload TEXT,
  cookie_checksum TEXT,
  cookie_count INTEGER,
  expires_summary TEXT,
  session_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_targets (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'fanqie',
  account_identity TEXT NOT NULL,
  local_work_id TEXT NOT NULL,
  remote_work_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, account_identity, remote_work_id)
);
CREATE TABLE IF NOT EXISTS fanqie_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  title TEXT,
  chapter_count INTEGER,
  latest_chapter_number INTEGER,
  raw TEXT,
  scanned_at TEXT NOT NULL,
  UNIQUE (account_id, work_id)
);
CREATE TABLE IF NOT EXISTS fanqie_remote_chapters (
  account_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  item_id TEXT,
  title TEXT,
  word_count INTEGER,
  published_at TEXT,
  raw TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (account_id, book_id, chapter_number)
);
CREATE TABLE IF NOT EXISTS publication_records (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  local_work_id TEXT NOT NULL,
  chapter_id INTEGER,
  chapter_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  remote_part_id TEXT,
  observed_status TEXT NOT NULL,
  published_at TEXT,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publication_records_target ON publication_records (target_id, chapter_number);
`;

export function findRepoRoot(start = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function resolveDataDir() {
  const dir = path.resolve(process.env.NOVEL_WRITER_DATA_DIR || path.join(findRepoRoot(), 'data'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let shared = null;

/** 打开（或复用）publisher.sqlite。测试可传入自定义路径。 */
export function openPublisherDb(file) {
  if (!file && shared) return shared;
  const db = new Database(file || path.join(resolveDataDir(), 'publisher.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  if (!file) shared = db;
  return db;
}

/** 只读打开 novel-writer 的作品库（apps/api 默认的 SQLite 文件）。不存在时返回 null。 */
export function openLibraryDb() {
  const file = path.resolve(process.env.NOVEL_WRITER_DB || path.join(resolveDataDir(), 'novel-writer.sqlite'));
  if (!fs.existsSync(file)) return null;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

const now = () => new Date().toISOString();
const parseJson = (text, fallback) => {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

function accountRowToApi(row) {
  return {
    accountId: row.account_id,
    id: row.account_id,
    name: row.name,
    aliases: parseJson(row.aliases, []),
    status: row.status,
    cookieChecksum: row.cookie_checksum,
    cookiesStorageType: 'local',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    session: {
      cookiesPayload: row.cookies_payload,
      cookieCount: row.cookie_count,
      syncedAt: row.session_synced_at,
      expiresSummary: parseJson(row.expires_summary, null),
    },
  };
}

export function listAccounts(db = openPublisherDb()) {
  return db.prepare('SELECT * FROM fanqie_accounts ORDER BY created_at').all().map(accountRowToApi);
}

export function ensureAccount(accountId, { name, aliases } = {}, db = openPublisherDb()) {
  const id = String(accountId || '').trim();
  if (!id) throw new Error('accountId is required');
  const t = now();
  db.prepare(`INSERT INTO fanqie_accounts (account_id, name, aliases, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO NOTHING`)
    .run(id, name || id, JSON.stringify(aliases || []), t, t);
  return accountRowToApi(db.prepare('SELECT * FROM fanqie_accounts WHERE account_id = ?').get(id));
}

export function recordAccountSession(input, db = openPublisherDb()) {
  ensureAccount(input.accountId, { name: input.accountName, aliases: input.aliases }, db);
  const t = now();
  db.prepare(`UPDATE fanqie_accounts SET
      name = COALESCE(?, name),
      aliases = COALESCE(?, aliases),
      cookies_payload = ?, cookie_checksum = ?, cookie_count = ?, expires_summary = ?,
      session_synced_at = ?, updated_at = ?
    WHERE account_id = ?`)
    .run(
      input.accountName || null,
      Array.isArray(input.aliases) ? JSON.stringify(input.aliases) : null,
      typeof input.cookiesPayload === 'string' ? input.cookiesPayload : JSON.stringify(input.cookiesPayload ?? null),
      input.cookieChecksum || null,
      Number.isFinite(Number(input.cookieCount)) ? Number(input.cookieCount) : null,
      input.expiresSummary ? JSON.stringify(input.expiresSummary) : null,
      t,
      t,
      String(input.accountId),
    );
  return { accountId: String(input.accountId), syncedAt: t };
}

/** 浏览器 runtime 使用的客户端，接口形状与旧的 Gateway bridge 保持一致。 */
export function createRuntimeDatabaseClient() {
  return {
    publication: {
      accounts: async () => ({ accounts: listAccounts() }),
      recordFanqieAccountSession: async (input) => ({ ok: true, item: recordAccountSession(input) }),
    },
  };
}

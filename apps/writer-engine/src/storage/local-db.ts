// writer-engine 的本地存储。项目只认识自己：语料、文章任务、写作反馈都放在
// 仓库 data/writer-engine.sqlite，不依赖任何外部数据库或网关。
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type SqliteDb = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS corpus_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'literary',
  source_path TEXT,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (channel, name)
);
CREATE TABLE IF NOT EXISTS corpus_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES corpus_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corpus_chunks_document ON corpus_chunks (document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS corpus_chunks_fts USING fts5(
  text, content='corpus_chunks', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS corpus_chunks_ai AFTER INSERT ON corpus_chunks BEGIN
  INSERT INTO corpus_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS corpus_chunks_ad AFTER DELETE ON corpus_chunks BEGIN
  INSERT INTO corpus_chunks_fts(corpus_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TABLE IF NOT EXISTS article_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  stage TEXT,
  last_message TEXT,
  request TEXT,
  events TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS writing_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT,
  title TEXT,
  verdict TEXT,
  user_feedback TEXT NOT NULL,
  draft_excerpt TEXT,
  source TEXT,
  created_at TEXT NOT NULL
);
`;

export function findRepoRoot(start = __dirname): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function resolveDataDir(): string {
  const dir = resolve(process.env.NOVEL_WRITER_DATA_DIR || join(findRepoRoot(), 'data'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

let shared: SqliteDb | null = null;

/** 打开（或复用）writer-engine.sqlite。测试可传入自定义路径（如 ':memory:'）。 */
export function openWriterDb(file?: string): SqliteDb {
  if (!file && shared) return shared;
  const db = new Database(file || join(resolveDataDir(), 'writer-engine.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  if (!file) shared = db;
  return db;
}

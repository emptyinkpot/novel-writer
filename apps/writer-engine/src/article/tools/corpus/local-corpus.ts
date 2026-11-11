// 本地语料库：替代原 DataBase Gateway 的检索能力。
// 语料存在 data/writer-engine.sqlite，用 SQLite FTS5（trigram 分词，支持中文子串）做全文检索。
// 对外方法名和返回结构与旧 Gateway 客户端保持一致，上层 context-builder 不需要知道底层换了。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { openWriterDb, type SqliteDb } from '../../../storage/local-db.ts';

/** 语料通道：reality 事实资料 / literary 文学范文 / lexicon 词库 / semantic 语义素材。 */
export type CorpusChannel = 'reality' | 'literary' | 'lexicon' | 'semantic';
export const CORPUS_CHANNELS: CorpusChannel[] = ['reality', 'literary', 'lexicon', 'semantic'];

export type CorpusHit = {
  document_id: string;
  document_name: string;
  chunk_id: string;
  chunk_text: string;
  score: number;
  corpus_channel: CorpusChannel;
  source_table: string;
};

const CHUNK_CHARS = 800;

export class LocalCorpus {
  private readonly db: SqliteDb;

  constructor(opts?: { db?: SqliteDb; timeout?: number; baseUrl?: string }) {
    this.db = opts?.db ?? openWriterDb();
  }

  get url(): string {
    return 'local://corpus';
  }

  // ---- 检索 ----

  search(query: string, options: { channels?: CorpusChannel[]; excludeChannels?: CorpusChannel[]; limit?: number } = {}): CorpusHit[] {
    const limit = Math.max(1, Math.min(Number(options.limit) || 5, 100));
    const terms = extractTerms(query);
    if (!terms.length) return [];
    const channelSql: string[] = [];
    const channelParams: string[] = [];
    if (options.channels?.length) {
      channelSql.push(`d.channel IN (${options.channels.map(() => '?').join(',')})`);
      channelParams.push(...options.channels);
    }
    if (options.excludeChannels?.length) {
      channelSql.push(`d.channel NOT IN (${options.excludeChannels.map(() => '?').join(',')})`);
      channelParams.push(...options.excludeChannels);
    }
    const where = channelSql.length ? `AND ${channelSql.join(' AND ')}` : '';

    const long = terms.filter((t) => [...t].length >= 3);
    const short = terms.filter((t) => [...t].length < 3);
    const rows: Array<Record<string, any>> = [];
    if (long.length) {
      // trigram 分词要求至少 3 个字符；用 OR 组合，bm25 越小越相关。
      const match = long.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
      rows.push(...this.db.prepare(`
        SELECT c.id AS chunk_id, c.text, d.id AS document_id, d.name, d.channel, bm25(corpus_chunks_fts) AS rank
        FROM corpus_chunks_fts f
        JOIN corpus_chunks c ON c.id = f.rowid
        JOIN corpus_documents d ON d.id = c.document_id
        WHERE corpus_chunks_fts MATCH ? ${where}
        ORDER BY rank LIMIT ?`).all(match, ...channelParams, limit) as Array<Record<string, any>>);
    }
    if (rows.length < limit && short.length) {
      const like = short.map(() => 'c.text LIKE ?').join(' OR ');
      const seen = new Set(rows.map((r) => r.chunk_id));
      const extra = this.db.prepare(`
        SELECT c.id AS chunk_id, c.text, d.id AS document_id, d.name, d.channel, 0 AS rank
        FROM corpus_chunks c JOIN corpus_documents d ON d.id = c.document_id
        WHERE (${like}) ${where} LIMIT ?`).all(...short.map((t) => `%${t}%`), ...channelParams, limit) as Array<Record<string, any>>;
      rows.push(...extra.filter((r) => !seen.has(r.chunk_id)).map((r) => ({ ...r, rank: 1 })));
    }
    return rows.slice(0, limit).map((row) => ({
      document_id: String(row.document_id),
      document_name: String(row.name),
      chunk_id: String(row.chunk_id),
      chunk_text: String(row.text),
      score: Number(row.rank) <= 0 ? 1 / (1 + Math.abs(Number(row.rank))) + 0.5 : 0.3,
      corpus_channel: row.channel as CorpusChannel,
      source_table: `local.corpus.${row.channel}`,
    }));
  }

  // ---- 与旧 Gateway 客户端兼容的接口 ----

  async getJson<T = Record<string, any>>(
    path: string,
    params: Record<string, string> = {},
    _label?: string,
    _datasetIds?: string[],
    _timeoutMs?: number,
  ): Promise<T> {
    switch (path) {
      case '/vocabulary/vector-search': {
        const items = this.search(params.q || params.query || '', { channels: ['lexicon'], limit: Number(params.limit) || 10 })
          .map((hit) => ({ ...hit, id: hit.chunk_id, text: hit.chunk_text }));
        return { items } as T;
      }
      case '/creative/style-contract':
      case '/creative/author-profile':
      case '/creative/article-structure':
        // 这几类风格/作者画像资料原先来自线上库，本地暂无对应数据源，返回空结构，上层会自动跳过。
        return {} as T;
      default:
        throw new Error(`local corpus: unsupported path ${path}`);
    }
  }

  async postJson<T = Record<string, any>>(path: string, body: Record<string, any> = {}): Promise<T> {
    if (path === '/search/vector/batch') return this.searchVectorBatch<T>(body.queries || []);
    throw new Error(`local corpus: unsupported path ${path}`);
  }

  /** 事实证据：只检索 reality 通道，组装成 EvidencePack 结构。 */
  async searchEvidence<T = Record<string, any>>(params: Record<string, string>, _datasetIds: string[] = [], _timeoutMs?: number): Promise<T> {
    const limit = Number(params.limit) || 8;
    const queries = [params.q || params.query, params.topic, ...String(params.webQueries || '').split('\n')]
      .map((q) => String(q || '').trim())
      .filter(Boolean);
    const uniqueQueries = [...new Set(queries)];
    const rounds: Array<Record<string, any>> = [];
    const hits = new Map<string, CorpusHit & { query: string }>();
    for (const query of uniqueQueries) {
      const found = this.search(query, { channels: ['reality'], limit });
      rounds.push({ query, provider: 'local.corpus', hitCount: found.length });
      for (const hit of found) if (!hits.has(hit.chunk_id)) hits.set(hit.chunk_id, { ...hit, query });
    }
    const chunks = [...hits.values()];
    const sources = [...new Map(chunks.map((c) => [c.document_id, {
      id: c.document_id,
      sourceId: c.document_id,
      title: c.document_name,
      provider: 'local.corpus',
      sourceTable: c.source_table,
      metadata: { provider: 'local.corpus', sourceTable: c.source_table, documentId: c.document_id },
    }])).values()];
    return {
      queryRun: { provider: 'local.corpus', rounds },
      screening: { version: 'local-corpus-v1', queryCount: uniqueQueries.length },
      sources,
      chunks: chunks.map((c) => ({
        id: c.chunk_id,
        chunkId: c.chunk_id,
        sourceId: c.document_id,
        documentId: c.document_id,
        title: c.document_name,
        text: c.chunk_text,
        relevanceScore: c.score,
        provider: 'local.corpus',
        metadata: { provider: 'local.corpus', sourceTable: c.source_table, retrievalQuery: c.query },
      })),
      citations: chunks.map((c) => ({ sourceId: c.document_id, chunkId: c.chunk_id })),
    } as T;
  }

  /** 非事实语料批量召回：文风、素材、主题补充。 */
  async searchVectorBatch<T = Record<string, any>>(queries: Array<{ q: string; limit: number; tag: string }>, _timeoutMs?: number): Promise<T> {
    return {
      results: queries.map((query) => ({
        query: query.q,
        tag: query.tag,
        items: this.search(query.q, { excludeChannels: ['reality'], limit: query.limit }),
      })),
    } as T;
  }

  /** 单条检索：联想扩展用。 */
  async searchVector<T = Record<string, any>>(params: Record<string, string>, _label?: string, _timeoutMs?: number): Promise<T> {
    const results = this.search(params.q || params.query || '', { limit: Number(params.limit) || 5 })
      .map((hit) => ({ ...hit, snippet: hit.chunk_text, title: hit.document_name }));
    return { results } as T;
  }

  // ---- 语料管理 ----

  /** 导入一篇文档：按段落切块后写入并建立全文索引。同名文档会被替换。 */
  importDocument(input: { name: string; text: string; channel: CorpusChannel; sourcePath?: string }): { documentId: number; chunks: number } {
    const text = input.text.replace(/\r\n/g, '\n').trim();
    const chunks = splitIntoChunks(text);
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM corpus_documents WHERE channel = ? AND name = ?').run(input.channel, input.name);
      const info = this.db.prepare('INSERT INTO corpus_documents (name, channel, source_path, char_count, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.name, input.channel, input.sourcePath ?? null, text.length, new Date().toISOString());
      const documentId = Number(info.lastInsertRowid);
      const insert = this.db.prepare('INSERT INTO corpus_chunks (document_id, chunk_index, text) VALUES (?, ?, ?)');
      chunks.forEach((chunk, index) => insert.run(documentId, index, chunk));
      return { documentId, chunks: chunks.length };
    })();
  }

  /** 递归导入目录下的 .txt / .md 文件。 */
  importDirectory(dir: string, channel: CorpusChannel): Array<{ name: string; chunks: number }> {
    const imported: Array<{ name: string; chunks: number }> = [];
    const walk = (current: string) => {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!['.txt', '.md'].includes(extname(entry).toLowerCase())) continue;
        const name = basename(entry, extname(entry));
        const result = this.importDocument({ name, text: readFileSync(full, 'utf8'), channel, sourcePath: full });
        imported.push({ name, chunks: result.chunks });
      }
    };
    walk(dir);
    return imported;
  }

  stats(): Record<string, any> {
    const byChannel = this.db.prepare(`
      SELECT d.channel, COUNT(DISTINCT d.id) AS documents, COUNT(c.id) AS chunks, COALESCE(SUM(LENGTH(c.text)), 0) AS chars
      FROM corpus_documents d LEFT JOIN corpus_chunks c ON c.document_id = d.id GROUP BY d.channel`).all() as Array<Record<string, any>>;
    const totals = byChannel.reduce((acc, row) => ({
      documents: acc.documents + Number(row.documents),
      chunks: acc.chunks + Number(row.chunks),
      chars: acc.chars + Number(row.chars),
    }), { documents: 0, chunks: 0, chars: 0 });
    return { ...totals, byChannel: Object.fromEntries(byChannel.map((row) => [row.channel, row])) };
  }
}

const STOP_WORDS = new Set(['一个', '一段', '一篇', '一种', '我们', '他们', '你们', '这个', '那个', '什么', '怎么', '如何', '以及', '或者', '但是', '因为', '所以', '进行', '关于', '的话']);

let jiebaCut: ((text: string) => string[]) | null | undefined;

/** 中文分词（jieba）；不可用时退回按标点切分。 */
function segment(text: string): string[] {
  if (jiebaCut === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jieba = require('jieba-wasm');
      jiebaCut = (value: string) => jieba.cut_for_search(value, true) as string[];
    } catch {
      jiebaCut = null;
    }
  }
  return jiebaCut ? jiebaCut(text) : [text];
}

/** 把查询拆成检索词：先按空白和标点切句，再对中文分词，去掉单字和常见虚词。 */
export function extractTerms(query: string): string[] {
  const pieces = String(query || '')
    .split(/[\s,，。、；;：:！!？?“”"'‘’（）()《》<>【】[\]{}|/\\-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const terms: string[] = [];
  for (const piece of pieces) {
    const words = /[一-鿿]/.test(piece) && [...piece].length > 2 ? segment(piece) : [piece];
    for (const word of words) {
      const w = word.trim();
      if ([...w].length >= 2 && !STOP_WORDS.has(w)) terms.push(w);
    }
  }
  return [...new Set(terms)].slice(0, 16);
}

/** 按段落聚合成约 800 字的块，超长段落硬切。 */
export function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += CHUNK_CHARS) chunks.push(paragraph.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (current && current.length + paragraph.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

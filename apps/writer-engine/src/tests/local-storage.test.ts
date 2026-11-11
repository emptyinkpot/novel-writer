import test from 'node:test';
import assert from 'node:assert/strict';
import { openWriterDb } from '../storage/local-db.ts';
import { LocalCorpus, extractTerms, splitIntoChunks } from '../article/tools/corpus/local-corpus.ts';
import { createArticleJobStore, type ArticleJob } from '../jobs/article-job-store.ts';

const reality = '雾港开埠于光绪年间，港口设有海关与灯塔。码头工人多来自周边渔村，潮汐决定了每日装卸的时辰。';
const literary = '雾从海上漫进来，把灯塔的光揉成一团昏黄。她站在码头尽头，听见缆绳在潮水里轻轻作响。';

function corpus() {
  const c = new LocalCorpus({ db: openWriterDb(':memory:') });
  c.importDocument({ name: '雾港志', text: reality, channel: 'reality' });
  c.importDocument({ name: '雾港来信', text: literary, channel: 'literary' });
  c.importDocument({ name: '海港词库', text: '缆绳 潮汐 灯塔 码头 舢板 汽笛', channel: 'lexicon' });
  return c;
}

test('full-text search finds Chinese substrings and respects channels', () => {
  const c = corpus();
  const hits = c.search('灯塔');
  assert.ok(hits.length >= 2);
  assert.deepEqual(c.search('海关与灯塔', { channels: ['reality'] }).map((h) => h.document_name), ['雾港志']);
  assert.equal(c.search('灯塔', { excludeChannels: ['reality', 'lexicon'] })[0].document_name, '雾港来信');
  assert.equal(c.search('完全不存在的词语组合').length, 0);
});

test('evidence pack has the structure the context builder expects', async () => {
  const pack: any = await corpus().searchEvidence({ q: '雾港 海关', limit: '5' });
  assert.equal(pack.queryRun.provider, 'local.corpus');
  assert.ok(pack.queryRun.rounds.length >= 1);
  assert.ok(pack.screening.version);
  assert.ok(pack.chunks.length >= 1 && pack.sources.length >= 1 && pack.citations.length >= 1);
  assert.ok(pack.chunks.every((chunk: any) => chunk.text && chunk.sourceId));
  // 文学范文不能混进事实证据
  assert.ok(pack.sources.every((source: any) => source.title === '雾港志'));
});

test('batch, single and vocabulary search return gateway-compatible shapes', async () => {
  const c = corpus();
  const batch: any = await c.searchVectorBatch([{ q: '码头', limit: 3, tag: 'topic' }]);
  assert.equal(batch.results[0].tag, 'topic');
  assert.ok(batch.results[0].items.every((item: any) => item.corpus_channel !== 'reality'));
  const single: any = await c.searchVector({ q: '潮汐', limit: '3' });
  assert.ok(single.results[0].snippet);
  const vocab: any = await c.getJson('/vocabulary/vector-search', { q: '缆绳', limit: '5' });
  assert.equal(vocab.items[0].corpus_channel, 'lexicon');
  assert.deepEqual(await c.getJson('/creative/author-profile'), {});
});

test('empty corpus returns an empty evidence pack instead of throwing', async () => {
  const pack: any = await new LocalCorpus({ db: openWriterDb(':memory:') }).searchEvidence({ q: '任何主题' });
  assert.equal(pack.chunks.length, 0);
});

test('re-importing a document replaces it', () => {
  const c = corpus();
  c.importDocument({ name: '雾港志', text: '全新的内容，只谈渔市与盐场。', channel: 'reality' });
  assert.equal(c.search('海关与灯塔', { channels: ['reality'] }).length, 0);
  assert.equal(c.stats().byChannel.reality.documents, 1);
});

test('chunking and term extraction', () => {
  assert.deepEqual(extractTerms('雾港，海关 与 灯塔！'), ['雾港', '海关', '灯塔']);
  const chunks = splitIntoChunks(`${'甲'.repeat(500)}\n${'乙'.repeat(500)}\n${'丙'.repeat(2000)}`);
  assert.ok(chunks.every((chunk) => chunk.length <= 800));
  assert.equal(chunks.join('').replace(/\n/g, '').length, 3000);
});

test('article job store persists lifecycle locally', async () => {
  const store = createArticleJobStore(openWriterDb(':memory:'));
  const now = new Date().toISOString();
  const job: ArticleJob = { id: 'job_1', status: 'queued', createdAt: now, startedAt: null, finishedAt: null, updatedAt: now, stage: 'queued', lastMessage: '', events: [], error: null, result: null };
  await store.create(job, { topic: '雾港' });
  await store.update({ ...job, status: 'finished', stage: 'done', events: [{ stage: 'done', message: 'ok', at: now }], result: { markdown: '# 雾港' }, finishedAt: now });
  const saved = await store.get('job_1');
  assert.equal(saved?.status, 'finished');
  assert.equal(saved?.events.length, 1);
  assert.deepEqual(await store.result('job_1'), { result: { markdown: '# 雾港' } });
  assert.equal(await store.get('missing'), null);
});

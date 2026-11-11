// 本地语料库命令行：
//   pnpm --filter @guga-write/writer-engine corpus import <目录> [--channel reality|literary|lexicon|semantic]
//   pnpm --filter @guga-write/writer-engine corpus stats
//   pnpm --filter @guga-write/writer-engine corpus search <关键词> [--channel ...]
import { resolve } from 'node:path';
import { CORPUS_CHANNELS, LocalCorpus, type CorpusChannel } from '../article/tools/corpus/local-corpus.ts';

function readChannel(args: string[]): CorpusChannel | undefined {
  const index = args.indexOf('--channel');
  if (index < 0) return undefined;
  const value = args[index + 1] as CorpusChannel;
  if (!CORPUS_CHANNELS.includes(value)) {
    throw new Error(`--channel 只能是 ${CORPUS_CHANNELS.join(' / ')}`);
  }
  return value;
}

function main() {
  const [command, target, ...rest] = process.argv.slice(2);
  const corpus = new LocalCorpus();
  if (command === 'import' && target) {
    const channel = readChannel(rest) ?? 'literary';
    const imported = corpus.importDirectory(resolve(target), channel);
    console.log(JSON.stringify({ channel, documents: imported.length, chunks: imported.reduce((n, d) => n + d.chunks, 0), imported }, null, 2));
    return;
  }
  if (command === 'stats') {
    console.log(JSON.stringify(corpus.stats(), null, 2));
    return;
  }
  if (command === 'search' && target) {
    const channel = readChannel(rest);
    console.log(JSON.stringify(corpus.search(target, { channels: channel ? [channel] : undefined, limit: 10 }), null, 2));
    return;
  }
  console.log('用法: corpus import <目录> [--channel reality|literary|lexicon|semantic] | corpus stats | corpus search <关键词> [--channel ...]');
  process.exitCode = 1;
}

main();

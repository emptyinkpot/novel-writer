// 语料诊断：汇总本地语料库和模型配置状态，不泄露密钥。
import { getRuntimeEnvDiagnostics, getWriterServiceDiagnostics } from '../config/env.ts';
import { LocalCorpus } from '../article/tools/corpus/local-corpus.ts';

export async function corpusDiagnostics() {
  return {
    corpus: new LocalCorpus().stats(),
    writer: getWriterServiceDiagnostics(),
    runtime: getRuntimeEnvDiagnostics(),
  };
}

# writer-engine

文章 agent 流水线（迁自 ContentBase）：检索本地语料 → 组装上下文 → 规划 → 写作 → 审校，返回完整正文、证据和诊断信息。

项目只认识自己：语料、任务、反馈都存在仓库根目录的 `data/writer-engine.sqlite`；模型接口与整个项目共用 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（也可用 `CONTENTBASE_LLM_*` 单独指定）。

## 运行

```bash
pnpm --filter @guga-write/writer-engine dev     # 构建并启动，默认 http://127.0.0.1:19203
pnpm --filter @guga-write/writer-engine test    # 本地存储与检索测试
```

浏览器打开 `http://127.0.0.1:19203/` 是任务控制台。

## 本地语料库

语料分四个通道：

| 通道 | 用途 |
| --- | --- |
| `reality` | 事实资料，作为 EvidencePack 进入上下文 |
| `literary` | 文学范文，提供文风与写法参考 |
| `lexicon` | 词库 |
| `semantic` | 其他语义素材 |

导入 `.txt` / `.md`（按段落切成约 800 字的块，建 SQLite FTS5 trigram 全文索引，支持中文子串检索）：

```bash
pnpm --filter @guga-write/writer-engine corpus import <目录> --channel reality
pnpm --filter @guga-write/writer-engine corpus stats
pnpm --filter @guga-write/writer-engine corpus search 灯塔 --channel literary
```

事实证据默认不强制：本地语料有命中就作为证据使用，没有命中会记录告警后继续创作。请求里给出 `keySources` / `evidenceQuery.required: true`，或设置 `WRITER_REQUIRE_EVIDENCE=1` 时才强制，证据不足会直接失败。

## HTTP 接口

```text
GET  /api/health
POST /api/content/runtime/generate/article             同步生成
POST /api/content/runtime/generate/article/jobs        异步任务
GET  /api/content/runtime/generate/article/jobs/{id}   任务进度
GET  /api/content/runtime/generate/article/jobs/{id}/result
GET  /api/content/runtime/generate/article/jobs/{id}/download
POST /api/content/runtime/generate/article/materials   只收集资料
POST /api/content/runtime/polish/article               润色
POST /api/content/runtime/final-edit/article           终稿编辑
POST /api/content/runtime/memory/feedback              记录写作反馈
GET  /api/corpus/diagnostics                           语料与模型配置状态
```

MCP 适配器在 `clients/mcp/`（`pnpm run mcp`），只调用上面的 HTTP 接口。

## 源码导览

| 路径 | 内容 |
| --- | --- |
| `src/server.ts` | HTTP 入口与路由 |
| `src/article/runtime/` | 生成主流程（article-runtime、article-flow、长度策略、重试） |
| `src/article/planning/context-builder.ts` | 检索与上下文组装 |
| `src/article/agents/planning/` | 资料阶段 agents：事实、发散、现实材料、上下文综合 |
| `src/article/agents/writing/` | 大纲、作者（正文）、补充材料 agents |
| `src/article/agents/review/` | 事实审查、AI 痕迹、格式、润色、终稿编辑 |
| `src/article/agents/prompts/` | 各 agent 的提示词 |
| `src/article/postprocess/` | 格式清理与文风检测 |
| `src/article/tools/corpus/local-corpus.ts` | 本地语料库 |
| `src/article/tools/llm/` | 模型调用 |
| `src/article/tools/storm/` | 可选的 STORM 研究规划（`CONTENTBASE_STORM_RESEARCH_URL`） |
| `src/jobs/` | 异步任务执行与存储 |
| `src/storage/local-db.ts` | SQLite 存储 |
| `src/cli/corpus.ts` | 语料命令行 |

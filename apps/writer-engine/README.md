# ContentBase

ContentBase 负责把检索到的材料合成上下文，运行文章 agent 全链路，然后返回一篇完整正文、可追踪证据和诊断信息。

核心运行表面只有一条链：

```text
Corpus
-> Retrieval
-> Composition
-> Writer
```

链外的东西不是合法 runtime。

## 日常调用

已经部署好的 ContentBase 不需要重新部署就能生成文章。日常调用只走已部署 HTTP 服务或 MCP。

MCP 入口：

```powershell
pnpm run mcp
```

MCP 源码在 `clients/mcp/`。这是调用适配器，不是产品 runtime；它只请求 `CONTENTBASE_TEST_BASE_URL` 指向的 ContentBase HTTP 服务，不执行 `git`、`ssh`、`docker`、部署或验收脚本。

更多边界见：

```text
clients/mcp/README.md
```

可用 MCP 工具：

```text
contentbase_health
contentbase_collect_materials
contentbase_generate_article
contentbase_get_job
contentbase_get_article_result
contentbase_polish_article
contentbase_final_edit_article
```

直接 HTTP 入口：

```text
POST /api/content/runtime/generate/article/jobs
GET  /api/content/runtime/generate/article/jobs/{id}
GET  /api/content/runtime/generate/article/jobs/{id}/result
POST /api/content/runtime/generate/article/materials
POST /api/content/runtime/polish/article
POST /api/content/runtime/final-edit/article
```

`tests/contentbase-acceptance.py` 只用于部署、验收和回归测试。日常生成不要运行这个脚本。

## 文档真源

```text
docs/article-engine.md
  article runtime、12-agent 拓扑、正文修改边界、长度纪律和结果契约。

docs/retrieval-architecture.md
  DataBase Gateway、RAGFlow、Reality/Literary/Semantic/Lexicon/Structure/Author 通道和 packing 规则。

docs/deploy-and-reproduce.md
  生产部署、复现、验收、v2.6.0 工程规范化说明和故障排查。

clients/mcp/README.md
  MCP 适配器用途、边界和 Codex/Claude Code 接入方式。
```

## 核心 Owner

DataBase Gateway 拥有持久语料、EvidencePack、RAGFlow 召回、来源 metadata 和 citation。

Search/Web provider 只提供临时现实材料，而且必须先经过 DataBase 通道进入 ContentBase。

ContentBase 拥有请求归一化、语料检索、上下文合成和 Writer 调用。

Writer 拥有一次完整正文生成；它不拥有检索，不拥有第二套改写路线。

外部服务配置的源码 owner 是：

```text
src/config/env.ts
```

核心 article runtime 在：

```text
src/article/
```

核心运行编排在：

```text
src/article/runtime/article-runtime.ts
src/article/runtime/article-flow.ts
```

agent 注册表和工具注册表在：

```text
src/article/registry/agents.ts
src/article/registry/tools.ts
```

## 运行边界

Reality 是必需项。如果缺 `DATABASE_GATEWAY_URL`、缺 EvidencePack，或者 EvidencePack 没有可用 sources/chunks/citations，生成必须 fail closed。

ContentBase 不能直接调用 RAGFlow。RAGFlow 只能通过 DataBase Gateway `/evidence/search` 或 corpus/vector endpoint 进入；被装进 context 时必须保留 provider/provenance metadata。

ContentBase runtime 不允许这些东西：

```text
fallback body
fallback provider/model
alternate Writer route
hidden Dify workflow
detached prose police
detached evaluator chain
source excerpt article assembly
local topic/source/category registries
notebook/material scope fallback
unbounded revision or rewrite loop
tail continuation as length completion
accepting degraded output as success
```

## Agent 拓扑

文章生成只有三层：

```text
Planning
-> Writing
-> Post-Writing Review
```

当前 active agents：

```text
Planning:
  fact_agent
  web_reality_agent
  divergence_agent
  meaning_agent

Writing:
  outline_agent
  author_agent
  enrichment_agent

Post-Writing Review:
  format_reviewer
  fact_reviewer
  style_reviewer
  revision_agent
  final_editor_agent
```

详细职责见 `docs/article-engine.md`。

## 部署与验收

生产部署入口：

```powershell
python scripts/deploy-contentbase-production.py
```

验收入口：

```powershell
python tests/contentbase-acceptance.py
```

常用检查：

```powershell
pnpm run check
pnpm run release:check
```

`tests/contentbase-acceptance.py` 是唯一有 release authority 的 ContentBase check entrypoint。Release acceptance 必须测试已部署 HTTP service，真实调用 DataBase Gateway、Writer 和 async article job，并把生成文章保存到本地。

## 生产位置

生产 runtime 在 RainYun（`rainyun` / `PRIVATE_IP_REMOVED`）。`server-124` 是 public TLS/nginx edge relay，不属于 ContentBase runtime owner。

生产 env 不写进 `Dockerfile`。运行中的 container 只通过 diagnostics 暴露脱敏 env provenance。

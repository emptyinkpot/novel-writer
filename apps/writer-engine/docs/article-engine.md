# Article Engine

本文记录当前 ContentBase article runtime。canonical article source root 是：

```text
src/article/
```

旧 article runtime 路径和聚合 agent 文件已经退役，不能重新引入。

## Runtime 形状

外层产品链是：

```text
Corpus
-> Retrieval
-> Composition
-> Writer
```

当前 article runtime 把 `Writer` 展开为 canonical agent fullchain：

```text
request_normalize
-> context_build
-> fact_agent / web_reality_agent / divergence_agent
-> meaning_agent
-> outline_agent
-> author_agent
-> enrichment_agent
-> format_reviewer / fact_reviewer / style_reviewer
-> revision_agent
-> final_editor_agent
-> format_postprocess
-> result_trace
```

`Writer` 指正文成文阶段，不是 detached rewrite system。

## Owners

`src/server.ts` 只负责 HTTP route binding 和 runtime injection。文章业务出口是 `src/article/index.ts`。

`src/article/runtime/article-runtime.ts` 是请求壳，负责 request normalization、context build、agent flow call 和 result projection。

`src/article/runtime/article-flow.ts` 是正式 agent 拓扑 owner，负责 Planning、Writing、Post-Writing Review 这 12 个 active agent 的触发顺序和产物交接。

`src/article/registry/agents.ts` 是 agent 注册表，只声明谁负责哪个稳定产物。

`src/article/registry/tools.ts` 是工具能力注册表，只声明 agent 可以调用哪些能力，以及这些能力能出现在哪一层。

`src/article/agents/planning/` 放 `fact_agent`、`web_reality_agent`、`divergence_agent` 和 `meaning_agent` 的实现。

`src/article/agents/writing/` 放 `outline_agent`、`author_agent` 和 `enrichment_agent` 的实现。

`src/article/agents/review/` 放 `format_reviewer`、`fact_reviewer`、`style_reviewer`、`revision_agent`、`final_editor_agent` 的实现，以及确定性 review sensors。

`src/article/tools/` 放可复用能力实现。`tools/llm/` 是 Writer model transport；`tools/http/` 是 HTTP JSON client；`tools/database/` 是 DataBase Gateway 和 Evidence query；`tools/storm/` 是 STORM client、query 和 research engine。

`src/article/context/` 放 source authority、Writer context projection 和 context diagnostics。

`src/article/planning/context-builder.ts` 是 planning/context facade；同层只保留 `types.ts` 和 `text-utils.ts` 这类共享契约与纯文本工具。

格式清理和 style sensor 留在 `src/article/postprocess/`。它们是 sensor 和格式清理，不是主要 prose engine。

`src/jobs/` 负责 async job persistence 和 lifecycle。

`tests/contentbase-acceptance.py` 是 release acceptance、本地结构契约和生成文章诊断入口。

## Agent 全链路

Canonical agents 是扁平产物 owner，不是嵌套调度器。

```text
Planning:
  fact_agent              -> knowledge_corpus_pack
  web_reality_agent       -> web_reality_pack
  divergence_agent        -> divergence_pack
  meaning_agent           -> context_prompt

Writing:
  outline_agent           -> outline_route
  author_agent            -> draft_body
  enrichment_agent        -> enriched_body

Post-Writing Review:
  format_reviewer         -> format_report
  fact_reviewer           -> fact_report
  style_reviewer          -> ai_residue_report
  revision_agent          -> revision_patch/final_body
  final_editor_agent      -> final_edit_patch/final_body
```

Planning 先并行启动 `fact_agent`、`web_reality_agent` 和 `divergence_agent`。`meaning_agent` 把三路材料合成 context prompt。

Writing 产出 outline route、完整 draft body，以及必要时的正文内部 enrichment。

Review 先报告 format、fact 和 AI-residue 问题，再由 `revision_agent` 在既有事实边界内做局部修订，最后由 `final_editor_agent` 通读全文、吸收补充材料并做一次终稿编辑。

这条 fullchain 不是 fallback route，它就是 canonical runtime。

## 职责边界

`fact_agent` 只回答“有哪些事实值得写”，不回答这些事实说明什么。

`web_reality_agent` 只整理已经通过 DataBase/Search 通道进入的现实材料，保留日期、机构、来源和动作，不解释材料意义。

`divergence_agent` 负责文风和美学材料采集，只回答“可以怎样观察”，不替后续 agent 定问题、定路线或写句子。

`meaning_agent` 把事实材料和美学材料收束成可写的事实关系。它不形成答案，不形成观点，不形成中心问题，不替 `outline_agent` 安排路线。

`outline_agent` 只形成给 `author_agent` 使用的写作路线，不写正文，不输出固定章节模板，不提前回答答案。

`author_agent` 一次输出完整正文。它是叙述者，不是提纲解释器；判断要从事实、动作和后果里长出来。

`enrichment_agent` 是唯一的续写/补充 agent，属于 Writing，不属于 Review。它只在正文低于长度窗口下限时运行，只补已有来源支撑的证据、动作和因果，不能尾部续写，不能新加结尾。

`format_reviewer` 只查产品格式。

`fact_reviewer` 只回答“是真的吗”。

`style_reviewer` 只回答“哪里像 AI 或结构跑偏”。

`revision_agent` 只处理审稿已经点名的局部文字纰漏，不新增事实，不重构全文。

`final_editor_agent` 在主链最后做一次全文终稿编辑：自评、查缺、补燃料、局部润色和少量补写，保证章节兑现标题、减少重复和空转。它可以使用已给大上下文、作者偏好和补充检索材料，但不能新增没有来源支撑的事实，不能重写全文。

## 长度和正文修改边界

目标长度是 `X`，runtime 从 `X ± tolerance` 推导有界预算窗口。当前 tolerance 是：

```text
min(1000, max(300, floor(X * 0.125)))
```

因此 `X=8000` 得到 `7000-9000` 只是例子，不是硬编码长度。

Writing 层拥有长度纪律：

- `author_agent` 应该让第一版完整草稿落在窗口内。
- `enrichment_agent` 是唯一的续写/补充 writer。
- enrichment 必须在正文内部薄弱处补充有来源材料。
- enrichment 不能尾部追加、不能开新结尾、不能写可拆掉的附录式续写。

Review 和 postprocess 不拥有长度修复权。Review 可以报告 overlength、underlength、repetition 和 AI smell。Postprocess 可以清理格式并暴露 sensors。两者都不能成为 main prose engine。

任何改动正文的操作都必须保持句子通顺和局部连贯。机械插入、regex-style patch、detached paragraph append 和 postprocess-driven prose repair 都不能作为 canonical length/completion mechanism。

## 允许的修订

`revision_agent` 可以：

- fix format issues reported by Format Reviewer;
- reduce repeated phrases and obvious template residue;
- improve sentence rhythm and local transitions;
- align preference and forbidden-word usage when supported by available context;
- correct clear factual overreach reported by Fact Reviewer.

`revision_agent` 不能：

- invent facts;
- add sources;
- create a new thesis;
- rebuild the article as a second generation route;
- expand with fresh web facts;
- bypass the canonical agent flow.

`final_editor_agent` 可以：

- evaluate the whole revised body once;
- use supplemental materials already retrieved through DataBase/RAG/Web;
- locally polish, bridge, delete repetition, or add a small sourced paragraph;
- return a complete final body.

`final_editor_agent` 不能：

- rewrite the whole article;
- add unsupported facts;
- replace the main line;
- create a second generation workflow.

Postprocess may:

- normalize format and disliked punctuation;
- break unsafe uniform paragraphs when configured;
- detect style violations;
- expose style profile metrics.

It must not become the main writing engine.

## Result Contract

`generateArticle()` returns:

```text
draft.body
draft.modelInvocation
draft.continuations
draft.minimumWordCount
draft.effectiveLength
draft.postProcess
draft.agentPipeline
context.evidence.pack
context.diagnostics
context.ragflowRecall
trace.modelInvocation
trace.context
trace.postProcess
trace.agentPipeline
trace.ending
```

Every successful fullchain result must expose:

- EvidencePack;
- RAGFlow recall summary;
- agent pipeline trace;
- postprocess diagnostics;
- model invocation trace.

## Acceptance

The release acceptance entrypoint is:

```text
tests/contentbase-acceptance.py
```

It verifies:

- local TypeScript and source contracts when run with `--local-checks-only`;
- HTTP health in release mode;
- corpus diagnostics;
- async article job lifecycle;
- generated body presence;
- EvidencePack source/chunk/citation counts;
- Writer model trace;
- `draft.agentPipeline`;
- RAGFlow recall status and channels;
- STORM diagnostics;
- style diagnostics saved with local output.

`pnpm run check` and `pnpm run release:check` route to `tests/contentbase-acceptance.py`.

## Forbidden Runtime

These remain forbidden:

- fallback body;
- fallback provider/model;
- alternate Writer route;
- hidden Dify workflow;
- detached prose police;
- detached evaluator chain;
- detached source-excerpt article assembly;
- local topic/source/category registries;
- notebook/material scope fallback;
- unbounded revision or rewrite loop;
- AST repair as article generation;
- tail continuation as length completion;
- accepting degraded output as success.

Planning/Writing/Review 层的注册 agent 不是例外通道；它们本身就是 named canonical fullchain。

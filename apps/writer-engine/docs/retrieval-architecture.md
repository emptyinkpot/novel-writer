# Retrieval Architecture

本文记录 ContentBase 的 Retrieval / Composition 真相。

## Owner

DataBase Gateway 拥有持久语料、EvidencePack、RAGFlow 召回、来源 metadata 和 citation。

ContentBase 只通过 DataBase Gateway 获取材料，不直接调用 RAGFlow。

```text
ContentBase
-> DataBase Gateway
-> EvidencePack / corpus / vector / style-contract
```

RAGFlow 属于 DataBase Gateway 后方。RAGFlow-backed material 只有在带 provider/provenance metadata 出现在 EvidencePack 或 corpus/vector results 里之后才有效。

## Corpus 通道

允许的 corpus channels：

```text
Reality
Literary
Semantic
Lexicon
Structure
Author
```

Reality 是必需项。Literary、Semantic、Lexicon、Structure 和 Author 是 writing context channels，不是 post-generation prose police，也不能变成 detached evaluator sidecars。

## Reality 边界

Reality 通过 DataBase Gateway EvidencePack 进入：

```text
ContentBase -> DataBase Gateway /evidence/search -> EvidencePack
```

这些情况必须 fail closed：

- `DATABASE_GATEWAY_URL` is missing.
- EvidencePack is missing.
- EvidencePack lacks usable sources, chunks or citations.
- zero Reality chunks survive normalization/packing.

如果 Reality 很薄，Writer 输出也必须收窄。

## 当前 Retrieval 层

```text
Layer 1: Reality (EvidencePack)
  Source: DataBase /evidence/search
  Method: Web + RAGFlow through Gateway
  Purpose: factual floor, current events, citations

Layer 2: Literary Corpus
  Source: DataBase /content/literature + /search/vector
  Method: curated literature plus RAGFlow-backed vector retrieval
  Purpose: style reference, prose examples, historical parallels

Layer 3: Semantic Units
  Source: DataBase /semantic/units
  Method: keyword search
  Purpose: semantic reference material, thematic context

Layer 4: Lexicon
  Source: DataBase /vocabulary/search + /creative/style-contract lexicon
  Method: direct load
  Purpose: banned words, preferred words, quality rules

Layer 5: Structure
  Source: DataBase /creative/style-contract
  Method: direct load
  Purpose: writing structure reference

Layer 6: Author
  Source: DataBase /creative/author-profile + /creative/style-contract
  Method: direct load
  Purpose: long-term author voice, techniques, preferences
```

## 资料收集边界

资料收集只负责让 Composition 前的材料池更丰富、更准、更可审计。

它不负责规定正文怎么写，不负责给 Author 加句法规则，也不负责在 Review 阶段补救文章。

非 Reality 资料池可以来自：

```text
resident style queries
  常驻文风和史论范本，用来找长期稳定的文学、史论和作者偏好材料

material discovery queries
  材料组织、制度史、战争史、海洋史、国家机器等资料收集种子

topic query variants
  根据当前主题扩出史料、制度、结构、文风等变体

random discovery seed
  少量随机发现，用来避免每次都召回同一批材料
```

这些 query 只决定“去找什么材料”。它们不能变成正文模板，不能变成句法微控，也不能越过 Reality 成为事实来源。

## Composition 审计

每次生成都必须让 final context 可审计，而且只能使用既有分类：

```json
{
  "reality": { "loaded": true, "chars": 0, "sources": 0 },
  "literary": { "loaded": true, "units": 0, "chars": 0 },
  "semantic": { "loaded": true, "units": 0, "chars": 0 },
  "lexicon": { "loaded": true, "units": 0, "chars": 0 },
  "structure": { "loaded": true, "patterns": 0 },
  "author": { "loaded": true, "chars": 0 },
  "composition": { "order": ["reality", "literary", "semantic", "lexicon", "structure", "author"], "truncated": [] }
}
```

审计不是评分层。它只证明什么材料进入了 final Writer prompt。

如果某个 category 已检索但没有进入 final Writer prompt，说明 runtime wiring 错了。

## Budget 原则

Token budget 从 Writer model 的实际 context window 反推。

```text
usable_budget = model_context_window * 0.45 - system_prompt_tokens - output_reserve
```

禁止硬编码超过任何已知模型窗口的数字。

预算收紧后靠 reranker 质量取胜，不靠数量。

目标分配：

```text
Reality:   35% of usable budget
Literary:  25% of usable budget
Semantic:  10% of usable budget
Lexicon:   12% of usable budget
Structure: 8% of usable budget
Author:    10% of usable budget
```

## 已完成改革

- jieba-wasm segmentation for Chinese query splitting.
- Per-term search 已收敛，不再让 literary channel 洪水式淹没 Reality。
- Lexicon compression.
- RAGFlow-backed `/search/vector` Gateway route.
- Dynamic token budget.
- Post-packing Reality gate.
- Literary channel 改为 style pool + minimal topic supplement.

## 禁止事项

Retrieval / Composition 不能做这些事：

- invent facts;
- bypass DataBase Gateway;
- direct-call RAGFlow from ContentBase;
- turn literary/semantic/lexicon/structure/author into prose police;
- accept warning as success when Reality is missing;
- create notebook/material fallback;
- create a second Writer route.

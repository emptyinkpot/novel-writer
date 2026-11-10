# ContentBase 部署与复现指南

适用于把 ContentBase 部署到新环境，并复现 v2.6.0 工程规范化后的稳定/可观测/可复测语义。

## 体系结构（必须先理解的边界）

ContentBase 是一条**多 agent 文章生成管线**，由两个独立服务支撑：

- **ContentBase**（本仓）：管线/HTTP 服务/验收测试。
- **DataBase Gateway**（仓 `emptyinkpot/DataBase`）：RAGFlow/web-evidence 的统一接入，ContentBase 通过 `DATABASE_GATEWAY_URL` 调用。

两个服务都用同一种部署模型：**git-pull + on-server docker build 的烤镜像 (baked image)**，由仓内 canonical 脚本驱动。本机仅做 push 触发，不做 scp/rsync/bind-mount。

## 一次性环境准备

### 1. 仓 + 部署主机

- 部署主机上准备一个目录作 source root（如 `/srv/contentbase-source`），克隆本仓到该目录。
- 同主机准备 `/srv/database-gateway-source` 给 DataBase 仓。
- 部署主机需能 `git fetch` 到本仓（HTTPS 或 SSH deploy key）。

### 2. Docker

- 部署主机有 docker + docker compose v2。
- 基镜像 `node:20-slim` 预拉一次（或允许构建时从 docker hub 拉）。

### 3. npm registry 镜像（中国大陆部署必读）

`registry.npmjs.org` 在部分网络环境（如雨云重庆 NAT）不可达，corepack 自身拉 pnpm tarball 也走 Cloudflare IP 会超时。本仓的 `Dockerfile.base` 已固化解法：

```dockerfile
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable \
  && pnpm config set registry https://registry.npmmirror.com \
  && pnpm install --prod=false --ignore-scripts --frozen-lockfile
```

如果你的部署主机能直连 npmjs.org，可以保留这两行（npmmirror 上海镜像对全球用户也快），或改回官方源。`pnpm-lock.yaml` 决定依赖版本，registry 只决定下载端点——切换不影响构建产物。

### 4. .env / secrets

部署主机的 source root 内放一份 `.env`，至少含：

- `DATABASE_GATEWAY_URL` — 指向同主机的 DataBase Gateway（同栈通常 `http://PRIVATE_IP_REMOVED:18090` 或 service name）
- `CONTENTBASE_LLM_PROFILE` — 主 LLM profile（默认 `deepseek`）
- `CONTENTBASE_LLM_DEEPSEEK_API_KEY` / `CONTENTBASE_LLM_DEEPSEEK_BASE_URL` / `CONTENTBASE_LLM_DEEPSEEK_MODEL`
- `CONTENTBASE_REVIEW_DEEPSEEK_*`（同上，给 DeepSeek 质量复评用）
- 可选 `CONTENTBASE_REVIEW_CLAUDE_*` 给 Claude 质量复评

具体字段在 `src/article/contracts.ts` 与 `model-runtime.ts`。

## 部署流程（canonical）

部署只走一条路径——`scripts/deploy-contentbase-production.py`。**禁止**直接在生产主机 `git pull && docker build && docker compose up`：这条脚本固化了 fetch / reset / build / recreate / 容器 env 校验五个步骤的不变量，绕开它就会再次出现"deploy 看起来成功了但 live 跑的不是 HEAD"的漂移。

### 本机部署一次

```bash
# 1) 本机改动 commit 后,从本机推送+触发服务器侧 git-pull + build + up
python scripts/deploy-contentbase-production.py
```

脚本会：

1. `git push origin HEAD:main`（也可 `--skip-push` 给已推送场景）
2. ssh 部署主机 `git fetch origin && git reset --hard HEAD`（源码对齐）
3. 同步 `.env` 中的 `SOURCE_COMMIT=<commit>` 字段
4. 计算 `package.json + pnpm-lock.yaml + pnpm-workspace.yaml` 的 sha256 当 base 镜像 tag
   （内容不变 → 命中缓存跳过 npm install，雨云 npm 抖动时不必每次重建）
5. `docker compose build && up -d --no-build`
6. `docker compose exec` 校验容器内 `DATABASE_GATEWAY_URL / SOURCE_COMMIT / CONTENTBASE_LLM_*` 都齐
7. 打出 `contentbase-deployed=<commit>`

### 重要参数

- `--remote-host` — 部署主机的 ssh 别名（默认 `rainyun`）
- `--source-root` — 服务器侧 git checkout 路径（默认 `/srv/contentbase-source`）
- `--commit` — 显式指定要部署的 commit（默认 `git rev-parse HEAD`）
- `--skip-push` — 提交已在远端时跳过本机 push

## 验收（acceptance）

`tests/contentbase-acceptance.py` 是 ContentBase 的端到端真实验收：跑真生成、断言长度窗口、断言 RAGFlow 召回通道齐全、跑双模型质量复评、保存成稿到 Downloads。

### 三种典型用法

```bash
# 1) 对本机 HEAD 全流程(本地 typecheck → 部署依赖 → 部署 ContentBase → 验收)
python tests/contentbase-acceptance.py --deploy

# 2) 对 live 已部署版本只跑 HTTP 验收
python tests/contentbase-acceptance.py --http-only --skip-dependency-deploy \
    --expected-source-commit <live commit short SHA>

# 3) 提交本地有 dirty change 时强行跑（带 marker commit）
python tests/contentbase-acceptance.py --deploy --require-deploy-marker-commit
```

### 默认行为（v2.6.0 起）

- **不再每次创建空 commit**：clean tree 默认只推 HEAD，不污染 git 历史。需要 marker 标记的少数场景用 `--require-deploy-marker-commit` opt-in。
- **run-id 关联**：每次跑生成一个 `run-id=YYYYMMDD-HHMMSS-XXXX`，标签 + 日志名 + 成稿文件名 + 给服务端的 `X-Request-Id` header 全部带上。回溯时一个 run-id 串起所有侧。
- **生成前预检 (preflight)**：发起 ~10 分钟生成前先打两个秒级 ping —— DataBase `/health/ragflow?retrieval=true` + writer LLM endpoint `/chat/completions` `max_tokens=1`。任一不通直接 fail-fast，不浪费时间。开 `--skip-preflight` 可绕过。
- **PASS/FAIL 聚合器**：硬检查任一挂 = FAIL；软检查（双模型复评、风格违规阈值、ending 闭合）挂 = PASS（with N soft warning(s)），收行打印每条 `⚠ ...` 详情。Windows 中文终端已自动 reconfigure 到 UTF-8，`⚠` 不会再撞 GBK。

## v2.6.0 工程规范化做了什么（碎裂识别）

会话场景：同一条管线连跑会在不同严格检查点失败、看起来像新 bug，本质是同一类"长度边界"问题。v2.6.0 把这件事变成可识别可定位。

### P1 稳定性

- 新增 `src/article/runtime/length-policy.ts`：唯一 `evaluateLength(body, window, stage)`，单一下限 `minChars`、单一上限 `maxChars`，删掉旧的 per-agent `0.82·orig / 0.84·orig / 1.12·orig / 1.16·orig` 软窗（这些和 `minChars` 在同一个会模式切换的测量函数上互相打架）。
- 新增 `src/article/runtime/retrying-agent.ts`：唯一 `runRetryingAgent({ label, maxAttempts, attempt, validate, buildFeedback, report })`，三个写作 agent（final-editor / revision / enrichment）共用，统一"校验失败→反馈→重试→耗尽抛"语义。
- enrichment 的累积式重试从 flow 层移进 agent，耗尽时抛 `agent_enrichment failed after N attempts`（不再静默冒泡，让 writer_draft 检查点谎报失败阶段）。
- flow 层 6 处长度检查点全走 `evaluateLength`，错误信息带准确 stage 名。

**预期可见效果**：失败信息从笼统的 `Writer returned incomplete article` 变成精确的 `agent_<stage> failed after N attempts: <stage>: <effective> effective chars below floor <min> (window <min>-<max>)`。同一题材重跑应收敛到同一阶段同一字数带。

### P2 可观测性

- `run-id` 全链路关联（日志/成稿/X-Request-Id）。
- 软失败显式进收行（不再静默埋进成稿 .md 的复评附录）。
- 生成前秒级 fail-fast 预检（10 分钟前知道池/RAGFlow 不行）。

### P3 可复测性

- 默认不造空 noise commit。
- DataBase base 镜像按 dep-hash 缓存（同 ContentBase）。
- npm registry 切换到 npmmirror（修部署主机出网受限场景）。
- corepack 自身的 pnpm 拉取也走 npmmirror（`COREPACK_NPM_REGISTRY`）。

## 故障排查速查

| 现象 | 真正含义 | 处置 |
| --- | --- | --- |
| `agent_enrichment failed after 4 attempts: enrichment: <N> effective chars below floor <min>` | LLM 在这条题材上凑不够汉字下限 | 内容侧问题（不是部署回归）：换题材 / 调 `minChars` / 换 writer 模型。 |
| `agent_revision failed after 3 attempts: revision: <N> effective chars below floor <min>` | 同上，撞在 revision 阶段 | 同上。 |
| `preflight: writer pool unavailable: HTTP 503` | writer LLM endpoint 没活号 | 给 deepseek key 充值 / 换 endpoint。 |
| `preflight: RAGFlow not ready` | DataBase Gateway 起来了但 RAGFlow 没活 | 检查 RAGFlow 容器（参见 `CLAUDE.md` 雨云 RAGFlow 真源指引）。 |
| 部署日志卡在 `corepack` / `pnpm install` 超时 | 部署主机不能直连 npmjs.org/Cloudflare | 本仓 `Dockerfile.base` 已用 npmmirror；确认 `COREPACK_NPM_REGISTRY` 在 RUN 之前。 |
| `UnicodeEncodeError: 'gbk' codec can't encode character '⚠'` | Windows GBK 终端撞软告警符号 | 升级到 v2.6.0（acceptance 已自动 reconfigure stdio 到 UTF-8）。 |
| 部署看起来 OK 但 live 跑旧代码 | 走了非 canonical 路径（手动 docker build） | 只走 `scripts/deploy-contentbase-production.py`；用 `ssh <host> 'docker exec <ctn> printenv SOURCE_COMMIT'` 校验。 |

## 关联文档

- `docs/article-engine.md` — 文章引擎内部 agent 拓扑
- `docs/content-pipeline.mmd` — 管线 mermaid 图
- `docs/contentbase-architecture.mmd` — ContentBase ↔ DataBase 架构图
- `scripts/deploy-contentbase-production.py` — canonical 部署脚本（唯一真源）
- `tests/contentbase-acceptance.py` — 端到端验收（唯一真源）

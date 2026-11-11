# 咕嘎写作架构

## 原则：项目只认识自己

- 从一份全新的 clone 出发，`pnpm install && pnpm -r run build` 之后就能在本地跑，不依赖任何外部服务。
- 所有外部端点（模型接口、MySQL、支付、微信）都是**可选**环境变量；缺省时退回仓库内的本地实现，或者该功能明确报「未配置」，不影响其余部分启动。
- 运行时数据统一放在仓库根目录 `data/`（已 gitignore），整个目录拷走即完成搬迁。可用 `NOVEL_WRITER_DATA_DIR` 改位置。
- 配置只读仓库根目录的 `.env`（可选，已 gitignore）。

## 运行

```bash
pnpm install
pnpm dev        # 同时启动 web / api / publisher / writer-engine
```

publisher 用 Python，需要本机有 `uv`；首次运行会自动建好虚拟环境。

## 组件

| 包 | 作用 | 端口 |
| --- | --- | --- |
| `apps/web` | Next.js 前端，`/api/*` rewrite 到 API | 19200 |
| `apps/api` | NestJS API：账号、作品、章节、对话、支付 | 19201 |
| `apps/publisher` | 番茄发布服务（Python：FastAPI + Playwright，uv 管理依赖）：账号登录态、作品扫描、章节发布与编辑、MCP | 19202 |
| `apps/writer-engine` | 文章 agent 流水线：本地语料检索 → 规划 → 写作 → 审校 | 19203 |
| `packages/shared` | 共享类型 | — |

## 本地数据

| 文件 | 内容 |
| --- | --- |
| `data/novel-writer.sqlite` | API 的用户、作品、章节、会话、订单（未设置 `DB_HOST` 时使用） |
| `data/.jwt-secret` | 未设置 `JWT_SECRET` 时自动生成，重启后登录态不丢 |
| `data/publisher.sqlite` | 番茄账号与 cookie、发布目标、远端作品/章节快照、发布记录 |
| `data/publisher/` | 番茄浏览器 profile、验收截图 |
| `data/writer-engine.sqlite` | 本地语料库（FTS5 全文索引）、文章任务、写作反馈 |

publisher 读取 `data/novel-writer.sqlite` 的 `nw_chapters` 作为待发布章节来源（只读）。

## 可选环境变量

| 变量 | 作用 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容模型接口，API 对话和 writer-engine 共用。未设置时对话接口返回 503「未配置模型接口」 |
| `WRITER_REQUIRE_EVIDENCE` | `1` 时 writer-engine 必须检索到事实资料才生成（默认不强制） |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASS` `DB_NAME` | 设置 `DB_HOST` 后 API 改用 MySQL（表结构见 `apps/api/init.sql`） |
| `JWT_SECRET` | 覆盖自动生成的 JWT 密钥 |
| `APP_URL` / `API_PUBLIC_URL` | 支付回调和跳转使用的外部地址，默认 `http://localhost:19200` |
| `WECHAT_*` / `ALIPAY_*` | 微信登录与支付；未设置时对应接口返回「未配置」 |
| `FANQIE_AUTO_RELOGIN` | `0` 关闭番茄自动登录（默认开启） |
| `FANQIE_SESSION_CACHE_MINUTES` | 番茄登录态校验通过后的缓存时间，默认 10 |
| `FANQIE_SESSION_WATCH_MINUTES` | 后台巡检间隔，默认 180，`0` 关闭 |
| `FANQIE_LOGIN_TIMEOUT_MS` | 等待人工登录的超时，默认 10 分钟 |

## 番茄登录态

publisher 的所有需要登录的操作（扫描、同步章节、发布、读取/编辑远端章节）都经过 `apps/publisher/src/fanqie_publisher/guard.py`：

1. 执行前快速检查（headless，不弹窗，结果缓存 10 分钟）。
2. 判定为过期（页面被重定向到登录页）时，打开番茄登录窗口；轮询窗口 cookie，检测到新的登录态后校验 uid 与原账号一致，写回 `data/publisher.sqlite` 并自动关窗；再用页面检查确认可用，然后执行任务。
3. 执行中失败时复查登录态，确认是过期导致的才重新登录并**重试一次**；其他失败原样返回。
4. 网络错误等无法判定的情况不会触发登录；同一账号同时只开一个登录窗口；登录取消、超时、换了别的番茄账号都会让任务失败并说明原因。
5. 后台巡检只更新状态（`GET /sessions/state`），从不弹窗。

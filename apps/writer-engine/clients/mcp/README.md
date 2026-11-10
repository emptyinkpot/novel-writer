# ContentBase MCP Client

`clients/mcp/` 是 ContentBase 的 MCP 适配器。它给 Codex、Claude Code 或其它支持 MCP 的外部 agent 提供一组工具，让这些 agent 直接调用已经部署好的 ContentBase HTTP 服务。

它不是 ContentBase 产品运行时，不是第二套文章生成链路，也不是部署脚本。

## 为什么放在主仓

MCP 工具的接口必须和 ContentBase HTTP API 同步变化。把这个适配器放在主仓里，是为了让下面三件事保持同一个版本真相：

- HTTP API 路径和请求体。
- MCP tool 名称和参数。
- release acceptance 对外部调用入口的约束。

因此 `clients/mcp/` 是主仓里的客户端适配层，而不是独立产品。它可以单独 build 和启动，但它的协议边界跟随本仓版本。

## 它做什么

它只做一件事：把 MCP tool call 转成对已部署 ContentBase HTTP 服务的请求。

本地优先读取仓库根目录 `.env`，再读取 `.env.example` 作为缺省值；后读的示例值不会覆盖你本地已经配置好的真实值。

默认服务地址来自：

```text
CONTENTBASE_TEST_BASE_URL=https://contentbase.example.invalid
```

可用工具：

```text
contentbase_health
contentbase_collect_materials
contentbase_generate_article
contentbase_get_job
contentbase_get_article_result
contentbase_polish_article
contentbase_final_edit_article
```

`contentbase_generate_article` 默认走轻量事实链：`includeWeb=false`、`includeRagflow=true`、`persistWeb=false`、`rounds=2`。如果你明确要重检索，可以在 tool call 里显式覆盖这些参数。

## 它不做什么

禁止在这里加入这些能力：

```text
git
ssh
docker
部署
验收
服务重启
本地源码生成文章
绕过 ContentBase HTTP API 的第二套 runtime
```

如果需要部署或验收，使用仓库根目录的 canonical 入口：

```text
scripts/deploy-contentbase-production.py
tests/contentbase-acceptance.py
```

如果需要文章生成，MCP 只能请求已部署服务；不能在 `clients/mcp/` 里重新实现 agent 编排。

## 启动

在仓库根目录运行：

```powershell
pnpm --dir clients/mcp run build
node clients/mcp/dist/contentbase-mcp.js
```

根目录也提供转发入口：

```powershell
pnpm run mcp
```

## Codex / Claude Code 接入

接入时使用已 build 的脚本作为 MCP server 命令：

```text
node E:\My Project\Content-Platform\repos\ContentBase\clients\mcp\dist\contentbase-mcp.js
```

环境变量只需要指向已部署 ContentBase：

```text
CONTENTBASE_TEST_BASE_URL=https://contentbase.example.invalid
CONTENTBASE_API_KEY=
```

`CONTENTBASE_API_KEY` 只在服务端启用鉴权时需要。

## 目录边界

```text
clients/mcp/
  package.json   MCP client 子包元数据
  tsconfig.json  只编译 MCP client
  src/           MCP tool 到 HTTP API 的适配源码
  dist/          build 产物
  README.md      本文件，说明 MCP client 边界
```

这个目录允许保留 `dist/`，因为外部 agent 配置通常直接指向可执行 JS 文件；如果以后改成包发布或根目录统一 build，再把 `dist/` 从 git/runtime 表面移走。

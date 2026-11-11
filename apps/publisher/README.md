# publisher

番茄发布服务：番茄账号登录态、作品扫描、章节发布、修改已发布章节、读取番茄公开页面。

- 数据存在仓库根目录 `data/publisher.sqlite`；待发布章节读取 `data/novel-writer.sqlite`（apps/api 的作品库）。
- 浏览器自动化用 Playwright，优先使用本机 Edge / Chrome。
- 登录窗口由 Playwright 打开，直接读取窗口 cookie 判断是否登录成功，Windows / Linux / macOS 通用。
- 登录态过期时自动打开登录窗口，确认登录、核对是同一个番茄账号后重试一次；后台巡检只记录状态，不弹窗。

## 运行

```bash
uv sync
uv run fanqie-publisher         # HTTP，默认 http://127.0.0.1:19202
uv run fanqie-publisher-mcp     # MCP（stdio），28 个工具与 HTTP 接口一一对应
uv run pytest                   # 测试
```

在仓库根目录执行 `pnpm dev` 时会一起启动。

## 源码

| 文件 | 内容 |
| --- | --- |
| `config.py` | 配置与数据目录 |
| `store.py` | 本地存储：账号与 cookie、发布目标、远端快照、发布记录、待发布章节解析 |
| `browser.py` | 浏览器 profile、cookie 注入与回写、后台页面状态采集 |
| `fanqie_pages.py` | 番茄后台页面操作：作品列表、章节列表、发布、读取/修改已发布章节 |
| `driver.py` | 登录态检查、登录窗口、各操作的返回结构 |
| `guard.py` | 登录态守卫：过期自动登录、确认后重试一次、后台巡检 |
| `services.py` | 账号锁、扫描、发布任务、编辑、发布前校验与对比 |
| `reader.py` | 番茄公开页面读取与 TXT 导出 |
| `api.py` | HTTP 接口 |
| `mcp_server.py` | MCP 接口 |

# publisher-py

番茄发布服务的 Python 版，与 `apps/publisher`（TypeScript 版）功能和接口一致，正在替换 TS 版。

- HTTP 接口、参数名、响应结构与 TS 版逐一对齐（`{success, data}` / `{success:false, code, error, details}`）。
- 共用 `data/publisher.sqlite`，表结构不变；待发布章节读取 `data/novel-writer.sqlite`。
- 浏览器自动化用 Playwright（Python），在服务进程内直接运行，不再另起 Node 子进程。
- 登录窗口由 Playwright 打开，直接读取窗口 cookie 判断是否登录成功，不需要解密浏览器 cookie 文件，Windows / Linux / macOS 通用。

## 运行

```bash
uv sync
uv run fanqie-publisher        # 默认 http://127.0.0.1:19202
uv run pytest                  # 测试
```

## 源码

| 文件 | 内容 |
| --- | --- |
| `config.py` | 配置与数据目录 |
| `store.py` | 本地存储：账号与 cookie、发布目标、远端快照、发布记录、章节解析 |
| `browser.py` | 浏览器 profile、cookie 注入与回写、后台页面状态采集 |
| `fanqie_pages.py` | 番茄后台页面操作：作品列表、章节列表、发布、读取/修改已发布章节 |
| `driver.py` | 平台驱动：登录态检查、登录窗口、各操作的返回结构 |
| `guard.py` | 登录态守卫：过期自动打开登录窗口、确认后重试一次、后台巡检 |
| `services.py` | 账号锁、扫描、发布任务、编辑、发布前校验与对比 |
| `reader.py` | 番茄公开页面读取与 TXT 导出 |
| `api.py` | HTTP 接口 |

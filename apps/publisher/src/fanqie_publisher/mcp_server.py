"""MCP 接口（stdio）：uv run fanqie-publisher-mcp。

28 个工具与 HTTP 接口一一对应，工具在进程内直接调用同一套 HTTP 路由，业务逻辑只有一份。
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

import httpx
import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

from .api import create_app
from .config import VERSION

S = {"type": "string"}
B = {"type": "boolean"}
N = {"type": "integer", "minimum": 1}
ID = {"type": ["string", "integer"]}


def obj(required: list[str] | None = None, **props: Any) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or [], "additionalProperties": False}


DB_CHAPTER = dict(targetId=S, accountId=S, bookId=S, localWorkId=ID, chapterId=ID, chapterNumber=N, idempotencyKey=S,
                  headless=B, dryRun=B, waitForCompletion=B, requestId=S)
EDIT_DB_CHAPTER = dict(targetId=S, accountId=S, bookId=S, localWorkId=ID, chapterId=ID, chapterNumber=N, itemId=S, title=S,
                       contentText=S, headless=B, dryRun=B, requestId=S)
PUBLISH = dict(accountId=S, bookId=S, chapterNumber=N, title=S, content=S, idempotencyKey=S, headless=B, dryRun=B,
               waitForCompletion=B, source=obj(workId=ID, chapterId=ID, requestId=S))


@dataclass
class Tool:
    name: str
    description: str
    method: str
    path: str
    schema: dict[str, Any]
    query: list[str] = field(default_factory=list)  # GET 查询参数
    wrap: str | None = None  # 列表结果包一层对象，便于结构化输出
    read_only: bool = False
    destructive: bool = False


TOOLS = [
    Tool("account.list", "列出本地番茄账号", "GET", "/accounts", obj(), wrap="accounts", read_only=True),
    Tool("account.login", "为账号打开番茄登录窗口", "POST", "/accounts/{accountId}/login", obj(["accountId"], accountId=S)),
    Tool("account.login.discover", "打开番茄登录页，人工登录后按 cookie 识别并建档新账号", "POST", "/accounts/login/discover", obj()),
    Tool("account.session.check", "检查账号登录态是否可用", "POST", "/accounts/{accountId}/session/check", obj(["accountId"], accountId=S),
         read_only=True),
    Tool("account.reauth", "检查登录态，失效时打开登录窗口直到登录完成并复查", "POST", "/accounts/{accountId}/reauth",
         obj(["accountId"], accountId=S)),
    Tool("work.scan", "扫描番茄后台作品列表", "POST", "/works/scan", obj(accountId=S, headed=B), wrap="works", read_only=True),
    Tool("chapter.remote.sync", "读取番茄作品的远端章节列表", "POST", "/chapters/remote/sync",
         obj(["accountId", "bookId"], accountId=S, bookId=S, refresh=B, persist=B), wrap="chapters", read_only=True),
    Tool("publish.chapter", "发布一章到番茄（完整发布流程）", "POST", "/publish/chapter",
         obj(["accountId", "bookId", "chapterNumber", "title", "content"], **PUBLISH), destructive=True),
    Tool("publish.tomato", "publish.chapter 的别名", "POST", "/publish/tomato",
         obj(["accountId", "bookId", "chapterNumber", "title", "content"], **PUBLISH), destructive=True),
    Tool("publish.database.chapter", "从作品库解析一章并发布到番茄", "POST", "/publish/database-chapter", obj(**DB_CHAPTER),
         destructive=True),
    Tool("publish.database.chapter.validate", "发布前校验：作品库章节与番茄远端章节对比", "POST", "/publish/database-chapter/validate",
         obj(**DB_CHAPTER), read_only=True),
    Tool("publish.next.database.chapter", "读取番茄最新章节号，发布作品库里的下一章", "POST", "/publish/next-database-chapter",
         obj(targetId=S, accountId=S, bookId=S, localWorkId=ID, dryRun=B, headless=B, waitForCompletion=B, requestId=S), destructive=True),
    Tool("publish.job.get", "查询发布任务状态", "GET", "/publish/jobs/{jobId}", obj(["jobId"], jobId=S), read_only=True),
    Tool("remote.chapter.get", "读取番茄已发布章节的标题和正文", "GET", "/remote/chapters/{bookId}/{itemId}",
         obj(["accountId", "bookId", "itemId"], accountId=S, bookId=S, itemId=S), query=["accountId"], read_only=True),
    Tool("remote.chapter.edit", "修改番茄已发布章节", "POST", "/edit/chapter",
         obj(["accountId", "bookId", "itemId"], accountId=S, bookId=S, itemId=S, title=S, contentText=S, headless=B, dryRun=B),
         destructive=True),
    Tool("database.chapter.edit", "用作品库里的章节内容覆盖番茄已发布章节", "POST", "/edit/database-chapter", obj(**EDIT_DB_CHAPTER),
         destructive=True),
    Tool("database.chapter.compare", "对比作品库章节与番茄已发布章节", "POST", "/edit/database-chapter/compare", obj(**EDIT_DB_CHAPTER),
         read_only=True),
    Tool("reader.book.search", "搜索番茄公开书籍", "GET", "/reader/search", obj(["query"], query=S, limit=N), query=["query", "limit"],
         wrap="books", read_only=True),
    Tool("reader.book.get", "读取番茄公开书籍详情和目录", "GET", "/reader/books/{bookId}", obj(["bookId"], bookId=S), read_only=True),
    Tool("reader.chapter.get", "读取番茄公开章节正文", "GET", "/reader/chapters/{itemId}", obj(["itemId"], itemId=S), read_only=True),
    Tool("reader.chapter.export.text", "导出单章 TXT", "POST", "/reader/export/chapter-text", obj(["itemId"], itemId=S, includeMeta=B),
         read_only=True),
    Tool("reader.book.export.text", "导出整本 TXT", "POST", "/reader/export/book-text",
         obj(["bookId"], bookId=S, itemIds={"type": "array", "items": S}, includeMeta=B), read_only=True),
    Tool("database.publication.targets", "列出发布目标（作品库作品 ↔ 番茄作品）", "GET", "/database/publication-targets",
         obj(platform=S, accountIdentity=S, localWorkId=ID, remoteWorkId=S, limit=N),
         query=["platform", "accountIdentity", "localWorkId", "remoteWorkId", "limit"], wrap="publicationTargets", read_only=True),
    Tool("database.fanqie.works", "列出已扫描的番茄作品", "GET", "/database/fanqie-works", obj(search=S, accountId=S, limit=N),
         query=["search", "accountId", "limit"], wrap="fanqieWorks", read_only=True),
    Tool("database.fanqie.works.sync", "扫描番茄作品并写入本地", "POST", "/database/sync-fanqie-works", obj(accountId=S, headed=B)),
    Tool("database.publication.target.register", "登记发布目标", "POST", "/database/register-publication-target",
         obj(["localWorkId"], targetId=S, accountId=S, accountIdentity=S, bookId=S, remoteWorkId=S, localWorkId=ID, title=S, author=S,
             status={"type": "string", "enum": ["active", "paused", "retired"]}, metadata={"type": "object"})),
    Tool("database.publish.context", "查询发布上下文", "GET", "/database/publish-context", obj(accountId=S, bookId=S, localWorkId=ID, limit=N),
         query=["accountId", "bookId", "localWorkId", "limit"], read_only=True),
    Tool("database.publish.chapter", "解析作品库里待发布的章节", "GET", "/database/publish-chapter",
         obj(accountId=S, bookId=S, localWorkId=ID, chapterId=ID, chapterNumber=N, idempotencyKey=S, requestId=S),
         query=["accountId", "bookId", "localWorkId", "chapterId", "chapterNumber", "idempotencyKey", "requestId"], read_only=True),
]
TOOLS_BY_NAME = {tool.name: tool for tool in TOOLS}


class ToolCallError(Exception):
    pass


async def call_tool(client: httpx.AsyncClient, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    tool = TOOLS_BY_NAME.get(name)
    if not tool:
        raise ToolCallError(f"unknown tool: {name}")
    args = dict(arguments or {})
    path = tool.path
    for key in [part[1:-1] for part in path.split("/") if part.startswith("{")]:
        if key not in args or args[key] in (None, ""):
            raise ToolCallError(f"{key} is required")
        path = path.replace("{" + key + "}", str(args[key]))
        if key not in tool.query:
            args.pop(key)
    if tool.method == "GET":
        params = {k: str(args[k]) for k in tool.query if args.get(k) not in (None, "")}
        response = await client.get(path, params=params)
    else:
        response = await client.post(path, json=args)
    payload = response.json()
    if not payload.get("success"):
        raise ToolCallError(f"[{payload.get('code')}] {payload.get('error')}")
    data = payload.get("data")
    return {tool.wrap: data} if tool.wrap else (data if isinstance(data, dict) else {"result": data})


def build_server() -> tuple[Server, httpx.AsyncClient]:
    app = create_app(start_watch=False)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fanqie-publisher", timeout=None)
    tool_list = [
        types.Tool(name=t.name, description=t.description, input_schema=t.schema,
                   annotations=types.ToolAnnotations(read_only_hint=t.read_only or None, destructive_hint=t.destructive or None))
        for t in TOOLS
    ]

    async def on_list_tools(_ctx, _params) -> types.ListToolsResult:
        return types.ListToolsResult(tools=tool_list)

    async def on_call_tool(_ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
        try:
            result = await call_tool(client, params.name, params.arguments or {})
        except ToolCallError as error:
            return types.CallToolResult(content=[types.TextContent(type="text", text=str(error))], is_error=True)
        return types.CallToolResult(content=[types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))],
                                    structured_content=result)

    server = Server("fanqie-service", version=VERSION, on_list_tools=on_list_tools, on_call_tool=on_call_tool)
    return server, client


async def run() -> None:
    server, client = build_server()
    try:
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())
    finally:
        await client.aclose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

import os
import sys
from pathlib import Path

import httpx
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from fanqie_publisher.api import build_container, create_app
from fanqie_publisher.mcp_server import TOOLS, ToolCallError, call_tool
from fanqie_publisher.store import PublicationStore

from conftest import FakeDriver, make_config, make_library


@pytest.fixture
async def client(tmp_path: Path):
    config = make_config(tmp_path)
    container = build_container(config, PublicationStore(config.publisher_db, library_db=config.library_db), FakeDriver())
    app = create_app(container, start_watch=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        yield http


def test_tool_catalog_is_complete():
    assert len(TOOLS) == 28
    assert len({t.name for t in TOOLS}) == 28


async def test_list_tools_are_wrapped(client):
    assert await call_tool(client, "account.list", {}) == {"accounts": []}
    works = await call_tool(client, "work.scan", {"accountId": "acc"})
    assert works["works"][0]["bookId"] == "7001"
    stored = await call_tool(client, "database.fanqie.works", {"search": "雾港"})
    assert stored["fanqieWorks"][0]["title"] == "雾港来信"


async def test_path_and_query_parameters(client, tmp_path: Path):
    make_library(tmp_path / "novel-writer.sqlite", [("第1章 雾起", "正文一"), ("第2章 潮声", "正文二")])
    target = await call_tool(client, "database.publication.target.register", {"accountId": "acc", "bookId": "7001", "localWorkId": 1})
    resolved = await call_tool(client, "database.publish.chapter", {"accountId": "acc", "bookId": "7001", "localWorkId": 1, "chapterNumber": 2})
    assert resolved["chapter"]["title"] == "第2章 潮声"
    detail = await call_tool(client, "remote.chapter.get", {"accountId": "acc", "bookId": "7001", "itemId": "i1"})
    assert detail["itemId"] == "i1"
    published = await call_tool(client, "publish.database.chapter", {"targetId": target["id"], "dryRun": True})
    assert published["status"] == "succeeded"


async def test_errors_raise(client):
    with pytest.raises(ToolCallError, match="publish_job_not_found"):
        await call_tool(client, "publish.job.get", {"jobId": "nope"})
    with pytest.raises(ToolCallError, match="jobId is required"):
        await call_tool(client, "publish.job.get", {})


async def test_stdio_handshake(tmp_path: Path):
    """按 AI 客户端的方式通过 stdio 连接，列出工具并调用一次。"""
    params = StdioServerParameters(command=sys.executable, args=["-m", "fanqie_publisher.mcp_server"],
                                   env={**os.environ, "NOVEL_WRITER_DATA_DIR": str(tmp_path), "FANQIE_SESSION_WATCH_MINUTES": "0"})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools
            assert len(tools) == 28
            result = await session.call_tool("account.list", {})
            assert result.is_error is False and result.structured_content == {"accounts": []}
            failed = await session.call_tool("publish.job.get", {"jobId": "nope"})
            assert failed.is_error is True

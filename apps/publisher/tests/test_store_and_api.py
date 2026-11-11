from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fanqie_publisher.api import build_container, create_app
from fanqie_publisher.browser import cookie_identity, cookie_payload
from fanqie_publisher.errors import ServiceError
from fanqie_publisher.reader import decode_text, extract_book_id, flatten_chapters, parse_initial_state
from fanqie_publisher.store import PublicationStore

from conftest import FakeDriver, make_config, make_library

CHAPTERS = [("第1章 雾起", "这是第1章的正文。"), ("第2章 潮声", "这是第2章的正文。"), ("第3章 灯塔", "这是第3章的正文。")]


# ---- 存储 ----

async def test_account_session_roundtrip(store: PublicationStore):
    cookies = [{"name": "sessionid", "value": "s1", "domain": ".fanqienovel.com", "path": "/"},
               {"name": "uid_tt", "value": "u1", "domain": ".fanqienovel.com", "path": "/", "expires": 9999999999}]
    store.record_account_session("acc", cookie_payload("acc", cookies), name="演示账号")
    accounts = await store.list_fanqie_accounts()
    assert [(a["id"], a["name"], a["meta"]["cookieCount"]) for a in accounts] == [("acc", "演示账号", 2)]
    assert cookie_identity(store.account_cookies("acc")) == {"uid": "u1", "session": "s1"}


async def test_next_unpublished_chapter_advances_after_record(tmp_path: Path, store: PublicationStore):
    make_library(tmp_path / "novel-writer.sqlite", CHAPTERS)
    target = await store.register_publication_target({"accountId": "acc", "bookId": "7001", "localWorkId": 1})
    first = await store.resolve_publish_chapter({"targetId": target["id"]})
    assert (first["chapter"]["chapterNumber"], first["publishInput"]["content"]) == (1, "这是第1章的正文。")
    await store.record_publication_result({"targetId": target["id"], "accountId": "acc", "bookId": "7001", "localWorkId": 1,
                                           "chapterId": first["chapter"]["id"], "chapterNumber": 1, "action": "publish_chapter",
                                           "observedStatus": "published"})
    second = await store.resolve_publish_chapter({"targetId": target["id"]})
    assert second["chapter"]["chapterNumber"] == 2
    explicit = await store.resolve_publish_chapter({"targetId": target["id"], "chapterNumber": 1})
    assert explicit["chapter"]["publishedAt"]


async def test_register_target_is_idempotent_per_remote_work(store: PublicationStore):
    a = await store.register_publication_target({"accountId": "acc", "bookId": "7001", "localWorkId": 1})
    b = await store.register_publication_target({"accountId": "acc", "bookId": "7001", "localWorkId": 2})
    assert a["id"] == b["id"] and b["localWorkId"] == "2"


async def test_missing_library_and_chapter_errors(tmp_path: Path, store: PublicationStore):
    await store.register_publication_target({"accountId": "acc", "bookId": "7001", "localWorkId": 1})
    with pytest.raises(ServiceError) as info:
        await store.resolve_publish_chapter({"accountId": "acc", "bookId": "7001", "localWorkId": 1})
    assert info.value.code == "library_not_found"
    make_library(tmp_path / "novel-writer.sqlite", CHAPTERS)
    with pytest.raises(ServiceError) as info:
        await store.resolve_publish_chapter({"accountId": "acc", "bookId": "7001", "localWorkId": 1, "chapterNumber": 9})
    assert info.value.code == "chapter_not_found"


async def test_sync_works_reports_insert_then_update(store: PublicationStore):
    work = {"accountId": "acc", "bookId": "7001", "title": "雾港来信", "scannedAt": "2026-11-11T00:00:00Z"}
    assert (await store.sync_fanqie_works([work]))["works"][0]["action"] == "inserted"
    assert (await store.sync_fanqie_works([work]))["works"][0]["action"] == "updated"
    assert (await store.list_fanqie_works({"search": "雾港"}))[0]["book_id"] == "7001"


# ---- HTTP ----

@pytest.fixture
def client(tmp_path: Path):
    config = make_config(tmp_path)
    fake = FakeDriver()
    container = build_container(config, PublicationStore(config.publisher_db, library_db=config.library_db), fake)
    with TestClient(create_app(container, start_watch=False)) as test_client:
        test_client.fake = fake  # type: ignore[attr-defined]
        test_client.container = container  # type: ignore[attr-defined]
        yield test_client


def test_health_and_error_envelope(client):
    health = client.get("/health").json()
    assert health["success"] is True and health["data"]["service"] == "fanqie-service"
    missing = client.get("/publish/jobs/nope")
    assert missing.status_code == 404
    assert missing.json() == {"success": False, "code": "publish_job_not_found", "error": "publish job not found", "details": None}


def test_publish_validation_and_dry_run(client):
    bad = client.post("/publish/chapter", json={"accountId": "acc"})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_publish_input"
    result = client.post("/publish/chapter", json={"accountId": "acc", "bookId": "7001", "chapterNumber": 1, "title": "t",
                                                   "content": "c", "dryRun": True}).json()["data"]
    assert result["status"] == "succeeded"
    assert "publish" in client.fake.calls  # 演练会真实打开新建章节页检查表单
    job = client.get(f"/publish/jobs/{result['jobId']}").json()["data"]
    assert job["status"] == "succeeded"


def test_publish_next_database_chapter_end_to_end(client, tmp_path: Path):
    make_library(tmp_path / "novel-writer.sqlite", CHAPTERS)
    target = client.post("/database/register-publication-target",
                         json={"accountId": "acc", "bookId": "7001", "localWorkId": 1}).json()["data"]
    client.fake.remote_chapters = [{"accountId": "acc", "bookId": "7001", "itemId": "i1", "chapterNumber": 1}]
    result = client.post("/publish/next-database-chapter", json={"targetId": target["id"]}).json()
    assert result["success"] is True and result["data"]["status"] == "succeeded"
    assert result["data"]["confirmation"]["chapterNumber"] == 2
    store = client.container.store
    assert store.published_at("1", 2) is not None


def test_edit_requires_title_or_content_and_supports_dry_run(client):
    bad = client.post("/edit/chapter", json={"accountId": "acc", "bookId": "7001", "itemId": "i1"})
    assert bad.status_code == 400
    dry = client.post("/edit/chapter", json={"accountId": "acc", "bookId": "7001", "itemId": "i1", "title": "第1章 新标题",
                                             "dryRun": True}).json()["data"]
    assert dry["verification"]["wouldChangeTitle"] is True
    assert "edit" not in client.fake.calls


def test_scan_persists_works_and_session_state(client):
    works = client.post("/works/scan", json={"accountId": "acc"}).json()["data"]
    assert works[0]["bookId"] == "7001"
    assert client.get("/database/fanqie-works").json()["data"][0]["title"] == "雾港来信"
    assert client.get("/accounts/acc/session/state").json()["data"]["status"] == "valid"


# ---- 公开页面解析 ----

def test_reader_parsing_helpers():
    assert extract_book_id("https://fanqienovel.com/page/7123456789012") == "7123456789012"
    assert decode_text(chr(58611) + chr(58590)) == "的一"
    state = parse_initial_state('<script>window.__INITIAL_STATE__={"page":{"bookId":"1"}};</script>')
    assert state == {"page": {"bookId": "1"}}
    chapters = flatten_chapters([{"volume_name": "卷一", "chapterList": [{"itemId": "9", "title": "第1章", "realChapterOrder": 1}]}])
    assert chapters == [{"itemId": "9", "title": "第1章", "chapterNumber": 1, "volumeName": "卷一", "isLocked": None}]


def test_chapter_number_parsing():
    from fanqie_publisher.fanqie_pages import parse_chapter_number as parse
    cases = {"第九十五章 x": 95, "第一百零三章": 103, "第十二章": 12, "第200章 镜子": 200, "第 7 章": 7,
             "第两千零一章": 2001, "五十八章 漏写第字": 58, "番外：后记": 0, "人物介绍": 0}
    assert {k: parse(k) for k in cases} == cases

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fanqie_publisher.api import build_container, create_app
from fanqie_publisher.fanqie_pages import plain_title
from fanqie_publisher.store import PublicationStore

from conftest import FakeDriver, make_config


@pytest.fixture
def client(tmp_path: Path):
    config = make_config(tmp_path)
    fake = FakeDriver()
    container = build_container(config, PublicationStore(config.publisher_db, library_db=config.library_db), fake)
    with TestClient(create_app(container, start_watch=False)) as test_client:
        test_client.fake = fake  # type: ignore[attr-defined]
        yield test_client


def test_list_and_get(client):
    listed = client.get("/drafts", params={"accountId": "acc", "bookId": "7001"}).json()
    assert listed["success"] and listed["data"][0]["title"] == "第 章 测试草稿"
    detail = client.get("/drafts/7001/d1", params={"accountId": "acc"}).json()["data"]
    assert detail["contentText"] == "正文"


def test_save_requires_title_and_content(client):
    bad = client.post("/drafts", json={"accountId": "acc", "bookId": "7001", "title": "t"})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_draft_input"
    saved = client.post("/drafts", json={"accountId": "acc", "bookId": "7001", "title": "t", "content": "c"}).json()["data"]
    assert saved["itemId"] == "d-new"


def test_update_requires_something_to_change(client):
    bad = client.post("/drafts/7001/d1", json={"accountId": "acc"})
    assert bad.status_code == 400
    updated = client.post("/drafts/7001/d1", json={"accountId": "acc", "content": "新正文"}).json()["data"]
    assert updated["itemId"] == "d1"


def test_delete_requires_title(client):
    bad = client.request("DELETE", "/drafts/7001/d1", json={"accountId": "acc"})
    assert bad.status_code == 400
    assert "delete_draft" not in client.fake.calls
    deleted = client.request("DELETE", "/drafts/7001/d1", json={"accountId": "acc", "title": "测试草稿"}).json()["data"]
    assert deleted["deleted"] is True


def test_publish_requires_chapter_number(client):
    bad = client.post("/drafts/7001/d1/publish", json={"accountId": "acc"})
    assert bad.status_code == 400
    dry = client.post("/drafts/7001/d1/publish", json={"accountId": "acc", "chapterNumber": 1, "dryRun": True}).json()["data"]
    assert dry["dryRun"] is True


def test_draft_operations_go_through_session_guard(client):
    client.fake.checks = ["expired", "valid"]
    client.get("/drafts", params={"accountId": "acc", "bookId": "7001"})
    assert client.fake.calls[:4] == ["check:expired", "login", "check:valid", "drafts"]


def test_plain_title():
    assert plain_title("第 章 测试草稿") == "测试草稿"
    assert plain_title("第12章 雾起") == "雾起"
    assert plain_title("第九十五章 x") == "x"
    assert plain_title("未命名草稿") == "未命名草稿"

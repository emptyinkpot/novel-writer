import asyncio

import pytest

from fanqie_publisher.errors import ServiceError
from fanqie_publisher.guard import SessionGuardedDriver

from conftest import FakeDriver

INPUT = {"accountId": "acc", "bookId": "b1", "chapterNumber": 1, "title": "t", "content": "c"}


async def test_valid_session_runs_once_and_caches():
    fake = FakeDriver()
    guard = SessionGuardedDriver(fake)
    await guard.publish_chapter(INPUT)
    await guard.publish_chapter(INPUT)
    assert fake.calls == ["check:valid", "publish", "publish"]
    assert guard.get_state("acc")["status"] == "valid"


async def test_expired_before_task_logs_in_then_runs():
    fake = FakeDriver()
    fake.checks = ["expired", "valid"]
    await SessionGuardedDriver(fake).publish_chapter(INPUT)
    assert fake.calls == ["check:expired", "login", "check:valid", "publish"]


async def test_expires_mid_task_relogin_and_retry_once():
    fake = FakeDriver()
    fake.checks = ["valid", "expired", "valid"]
    fake.publish_failures = 1
    await SessionGuardedDriver(fake).publish_chapter(INPUT)
    assert fake.calls == ["check:valid", "publish", "check:expired", "login", "check:valid", "publish"]


async def test_failure_not_caused_by_session_is_raised_without_login():
    fake = FakeDriver()
    fake.checks = ["valid", "valid"]
    fake.publish_failures = 1
    with pytest.raises(ServiceError, match="page redirected"):
        await SessionGuardedDriver(fake).publish_chapter(INPUT)
    assert "login" not in fake.calls


async def test_unknown_status_never_triggers_login():
    fake = FakeDriver()
    fake.checks = ["unknown"]
    await SessionGuardedDriver(fake).publish_chapter(INPUT)
    assert fake.calls == ["check:unknown", "publish"]


@pytest.mark.parametrize("reason", ["cancelled", "timeout", "identity_mismatch"])
async def test_login_failure_stops_task(reason):
    fake = FakeDriver()
    fake.checks = ["expired"]
    fake.login_status, fake.login_reason = "failed", reason
    guard = SessionGuardedDriver(fake)
    with pytest.raises(ServiceError) as info:
        await guard.publish_chapter(INPUT)
    assert info.value.code == f"fanqie_login_{reason}"
    assert "publish" not in fake.calls
    assert guard.get_state("acc")["status"] == "login_failed"


async def test_login_completes_but_still_invalid():
    fake = FakeDriver()
    fake.checks = ["expired", "expired"]
    with pytest.raises(ServiceError) as info:
        await SessionGuardedDriver(fake).publish_chapter(INPUT)
    assert info.value.code == "fanqie_relogin_unverified"
    assert "publish" not in fake.calls


async def test_concurrent_tasks_share_one_login_window():
    fake = FakeDriver()
    fake.checks = ["expired", "expired", "valid"]
    fake.login_delay = 0.05
    guard = SessionGuardedDriver(fake)
    await asyncio.gather(guard.publish_chapter(INPUT), guard.publish_chapter(INPUT))
    assert fake.calls.count("login") == 1
    assert fake.calls.count("publish") == 2


async def test_auto_relogin_disabled_reports_login_required():
    fake = FakeDriver()
    fake.checks = ["expired"]
    with pytest.raises(ServiceError) as info:
        await SessionGuardedDriver(fake, auto_relogin=False).publish_chapter(INPUT)
    assert info.value.code == "fanqie_login_required"
    assert "login" not in fake.calls


async def test_missing_account_errors_without_login():
    fake = FakeDriver()
    fake.checks = ["missing"]
    with pytest.raises(ServiceError) as info:
        await SessionGuardedDriver(fake).publish_chapter(INPUT)
    assert info.value.code == "fanqie_account_missing"
    assert "login" not in fake.calls


async def test_background_refresh_only_records_state():
    fake = FakeDriver()
    fake.checks = ["expired"]
    state = await SessionGuardedDriver(fake).refresh_state("acc")
    assert state["status"] == "expired"
    assert fake.calls == ["check:expired"]

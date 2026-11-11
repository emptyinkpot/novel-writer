"""HTTP 接口。路径、参数名和响应结构与 TS 版一致：成功 {success, data}，失败 {success:false, code, error, details}。"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .browser import BrowserRuntime
from .config import Config, load_config
from .driver import FanqieDriver, PlaywrightFanqieDriver
from .errors import ServiceError
from .guard import SessionGuardedDriver, session_watch_loop
from .reader import FanqieReader
from .services import AccountLock, EditService, PlanningService, PublishService, ScanService, SessionService
from .store import PublicationStore, now_iso


@dataclass
class Container:
    config: Config
    store: PublicationStore
    driver: SessionGuardedDriver
    lock: AccountLock
    sessions: SessionService
    scan: ScanService
    publish: PublishService
    edit: EditService
    planning: PlanningService
    reader: FanqieReader


def build_container(config: Config | None = None, store: PublicationStore | None = None,
                    inner_driver: FanqieDriver | None = None) -> Container:
    config = config or load_config()
    store = store or PublicationStore(config.publisher_db, library_db=config.library_db)
    inner = inner_driver or PlaywrightFanqieDriver(config, BrowserRuntime(config, store))
    driver = SessionGuardedDriver(inner, cache_seconds=config.session_cache_seconds, auto_relogin=config.auto_relogin)
    lock = AccountLock()
    scan = ScanService(driver, store, lock)
    edit = EditService(driver, lock)
    return Container(config, store, driver, lock, SessionService(driver), scan, PublishService(driver, lock), edit,
                     PlanningService(store, scan, edit), FanqieReader())


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse({"success": True, "data": data}, status_code=status)


def q(request: Request, *names: str) -> str | None:
    for name in names:
        value = request.query_params.get(name)
        if value is not None and value.strip():
            return value.strip()
    return None


def qn(request: Request, *names: str) -> float | None:
    text = q(request, *names)
    try:
        return float(text) if text is not None else None
    except ValueError:
        return None


async def body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError as error:
        raise ServiceError("invalid_json", f"request body is not valid JSON: {error}", 400) from error
    return parsed if isinstance(parsed, dict) else {}


def store_error(error: Exception) -> ServiceError:
    return error if isinstance(error, ServiceError) else ServiceError("local_store_error", str(error), 500)


def create_app(container: Container | None = None, *, start_watch: bool = True) -> FastAPI:
    c = container or build_container()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        task = None
        if start_watch and c.config.session_watch_minutes > 0:
            async def account_ids() -> list[str]:
                return [a["id"] for a in await c.store.list_fanqie_accounts() if a["status"] == "active"]
            task = asyncio.create_task(session_watch_loop(c.driver, account_ids, c.lock.run, c.config.session_watch_minutes * 60))
        yield
        if task:
            task.cancel()

    app = FastAPI(title="fanqie-publisher", version=c.config.version, lifespan=lifespan)
    app.state.container = c

    @app.exception_handler(ServiceError)
    async def _service_error(_request: Request, error: ServiceError):
        return JSONResponse({"success": False, "code": error.code, "error": error.message, "details": error.details},
                            status_code=error.status)

    @app.exception_handler(Exception)
    async def _unexpected(_request: Request, error: Exception):
        return JSONResponse({"success": False, "code": "internal_error", "error": str(error), "details": None}, status_code=500)

    # ---- 健康与账号 ----

    @app.get("/health")
    async def health():
        return ok({"ok": True, "service": "fanqie-service", "version": c.config.version, "time": now_iso(),
                   "driver": {"configured": c.driver.configured, "name": c.driver.name}})

    @app.get("/accounts")
    async def accounts():
        return ok(await c.store.list_fanqie_accounts())

    @app.post("/accounts/login/discover")
    async def login_discover():
        return ok(await c.driver.login_discovered())

    @app.post("/accounts/{account_id}/login")
    async def login(account_id: str):
        return ok(await c.driver.login(account_id))

    @app.post("/accounts/{account_id}/session/check")
    async def session_check(account_id: str):
        return ok(await c.driver.check_session(account_id))

    @app.get("/sessions/state")
    async def sessions_state():
        return ok(c.driver.list_states())

    @app.get("/accounts/{account_id}/session/state")
    async def session_state(account_id: str):
        return ok(c.driver.get_state(account_id))

    @app.post("/accounts/{account_id}/reauth")
    async def reauth(account_id: str):
        return ok(await c.sessions.reauth(account_id))

    # ---- 扫描 ----

    @app.post("/works/scan")
    async def works_scan(request: Request):
        return ok(await c.scan.scan_works(await body(request)))

    @app.post("/chapters/remote/sync")
    async def chapters_sync(request: Request):
        return ok(await c.scan.sync_remote_chapters(await body(request)))

    # ---- 发布 ----

    @app.post("/publish/chapter")
    @app.post("/publish/tomato")
    async def publish_chapter(request: Request):
        return ok(await c.publish.publish_chapter(await body(request)))

    async def record_publish(resolved: dict[str, Any], result: dict[str, Any], data: dict[str, Any]) -> None:
        confirmation = result.get("confirmation")
        if resolved["publishInput"].get("dryRun") is True or result.get("status") != "succeeded" or not confirmation:
            return
        matched = (confirmation.get("evidence") or {}).get("matchedChapter") or {}
        await c.store.record_publication_result({
            "targetId": data.get("targetId") if str(data.get("targetId") or "").strip() else None,
            "accountId": resolved["accountId"], "bookId": resolved["bookId"], "localWorkId": resolved["localWorkId"],
            "chapterId": resolved["chapter"]["id"], "chapterNumber": resolved["chapter"]["chapterNumber"],
            "contentPartId": f"legacy_chapter_{resolved['chapter']['id']}", "action": "publish_chapter",
            "remotePartId": str(matched["itemId"]) if isinstance(matched, dict) and matched.get("itemId") else None,
            "observedStatus": "published" if confirmation.get("confirmed") else "submitted",
            "publishedAt": confirmation.get("confirmedAt"), "result": {"jobId": result["jobId"], "confirmation": confirmation},
        })

    @app.post("/publish/database-chapter")
    async def publish_database_chapter(request: Request):
        data = await body(request)
        try:
            resolved = await c.store.resolve_publish_chapter(data)
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error
        result = await c.publish.publish_chapter(resolved["publishInput"])
        await record_publish(resolved, result, data)
        return ok(result)

    @app.post("/publish/database-chapter/validate")
    async def publish_validate(request: Request):
        try:
            return ok(await c.planning.validate_database_chapter(await body(request)))
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    @app.post("/publish/next-database-chapter")
    async def publish_next(request: Request):
        data = await body(request)
        try:
            context = await c.store.get_publish_context(data)
            account_id = _required(context.get("accountId") or data.get("accountId"), "accountId")
            book_id = _required(context.get("bookId") or data.get("bookId"), "bookId")
            local_work_id = _required(context.get("localWorkId") or data.get("localWorkId"), "localWorkId")
            chapters = await c.scan.sync_remote_chapters({"accountId": account_id, "bookId": book_id, "refresh": True, "persist": False})
            latest = max((int(ch.get("chapterNumber") or 0) for ch in chapters), default=0)
            resolved = await c.store.resolve_publish_chapter(
                {**data, "accountId": account_id, "bookId": book_id, "localWorkId": local_work_id, "chapterNumber": latest + 1})
            result = await c.publish.publish_chapter(resolved["publishInput"])
            await record_publish(resolved, result, data)
            return ok(result)
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    @app.get("/publish/jobs/{job_id}")
    async def publish_job(job_id: str):
        job = c.publish.get_job(job_id)
        if not job:
            raise ServiceError("publish_job_not_found", "publish job not found", 404)
        return ok(job)

    # ---- 编辑 ----

    @app.get("/remote/chapters/{book_id}/{item_id}")
    async def remote_chapter(book_id: str, item_id: str, request: Request):
        return ok(await c.edit.get_remote_chapter({"accountId": q(request, "accountId", "account_id"), "bookId": book_id, "itemId": item_id}))

    @app.post("/edit/chapter")
    async def edit_chapter(request: Request):
        return ok(await c.edit.edit_remote_chapter(await body(request)))

    @app.post("/edit/database-chapter")
    async def edit_database_chapter(request: Request):
        data = await body(request)
        try:
            resolved = await c.store.resolve_publish_chapter(data)
            item_id = data["itemId"].strip() if isinstance(data.get("itemId"), str) and data["itemId"].strip() else \
                await c.planning.resolve_remote_item_id(data, resolved)
            result = await c.edit.edit_remote_chapter({
                "accountId": resolved["accountId"], "bookId": resolved["bookId"], "itemId": item_id,
                "title": data["title"] if str(data.get("title") or "").strip() else resolved["chapter"]["title"],
                "contentText": data["contentText"] if str(data.get("contentText") or "").strip() else resolved["chapter"]["content"],
                "headless": data.get("headless"), "dryRun": data.get("dryRun"),
            })
            if data.get("dryRun") is not True and result.get("success") is True:
                await c.store.record_publication_result({
                    "targetId": data.get("targetId") if str(data.get("targetId") or "").strip() else None,
                    "accountId": resolved["accountId"], "bookId": resolved["bookId"], "localWorkId": resolved["localWorkId"],
                    "chapterId": resolved["chapter"]["id"], "chapterNumber": resolved["chapter"]["chapterNumber"],
                    "contentPartId": f"legacy_chapter_{resolved['chapter']['id']}", "action": "edit_chapter",
                    "remotePartId": result["itemId"], "observedStatus": "edited", "publishedAt": now_iso(),
                    "result": {"editResult": result},
                })
            return ok(result)
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    @app.post("/edit/database-chapter/compare")
    async def edit_compare(request: Request):
        try:
            return ok(await c.planning.compare_database_chapter(await body(request)))
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    # ---- 本地发布数据 ----

    @app.get("/database/publication-targets")
    async def db_targets(request: Request):
        return ok(await c.store.list_publication_targets({
            "platform": q(request, "platform"), "accountIdentity": q(request, "accountIdentity", "account_identity"),
            "localWorkId": q(request, "localWorkId", "local_work_id"),
            "remoteWorkId": q(request, "remoteWorkId", "remote_work_id", "bookId", "book_id"), "limit": qn(request, "limit"),
        }))

    @app.get("/database/fanqie-works")
    async def db_works(request: Request):
        return ok(await c.store.list_fanqie_works({"search": q(request, "search"), "accountId": q(request, "accountId", "account_id"),
                                                   "limit": qn(request, "limit")}))

    @app.post("/database/sync-fanqie-works")
    async def db_sync_works(request: Request):
        works = await c.scan.scan_works(await body(request))
        return ok(await c.store.sync_fanqie_works(works))

    @app.post("/database/register-publication-target")
    async def db_register(request: Request):
        try:
            return ok(await c.store.register_publication_target(await body(request)))
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    @app.get("/database/publish-context")
    async def db_context(request: Request):
        try:
            return ok(await c.store.get_publish_context({
                "accountId": q(request, "accountId", "account_id"),
                "bookId": q(request, "bookId", "book_id", "remoteWorkId", "remote_work_id"),
                "localWorkId": q(request, "localWorkId", "local_work_id"), "limit": qn(request, "limit"),
            }))
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    @app.get("/database/publish-chapter")
    async def db_publish_chapter(request: Request):
        number = qn(request, "chapterNumber", "chapter_number")
        try:
            return ok(await c.store.resolve_publish_chapter({
                "accountId": q(request, "accountId", "account_id"),
                "bookId": q(request, "bookId", "book_id", "remoteWorkId", "remote_work_id"),
                "localWorkId": q(request, "localWorkId", "local_work_id"), "chapterId": q(request, "chapterId", "chapter_id"),
                "chapterNumber": int(number) if number is not None else None,
                "idempotencyKey": q(request, "idempotencyKey", "idempotency_key"), "requestId": q(request, "requestId", "request_id"),
            }))
        except Exception as error:  # noqa: BLE001
            raise store_error(error) from error

    # ---- 公开页面读取 ----

    @app.get("/reader/search")
    async def reader_search(request: Request):
        limit = qn(request, "limit")
        return ok(await c.reader.search_books(q(request, "q", "query") or "", int(limit) if limit else None))

    @app.get("/reader/books/{book_id}")
    async def reader_book(book_id: str):
        return ok(await c.reader.get_book_detail(book_id))

    @app.get("/reader/chapters/{item_id}")
    async def reader_chapter(item_id: str):
        return ok(await c.reader.get_chapter_detail(item_id))

    @app.get("/reader/comments/{book_id}")
    async def reader_comments(book_id: str, request: Request):
        return ok(await c.reader.get_book_comments(book_id, int(qn(request, "limit") or 30)))

    @app.post("/reader/export/chapter-text")
    async def reader_export_chapter(request: Request):
        data = await body(request)
        return ok(await c.reader.export_chapter_text(str(data.get("itemId") or "").strip(), data.get("includeMeta") is not False))

    @app.post("/reader/export/book-text")
    async def reader_export_book(request: Request):
        data = await body(request)
        item_ids = [str(i).strip() for i in data.get("itemIds") or [] if str(i).strip()] if isinstance(data.get("itemIds"), list) else None
        return ok(await c.reader.export_book_text(str(data.get("bookId") or "").strip(), item_ids or None,
                                                  data.get("includeMeta") is not False))

    return app


def _required(value: Any, field: str) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        raise ServiceError("database_publish_context_incomplete", f"{field} is required", 422)
    return text

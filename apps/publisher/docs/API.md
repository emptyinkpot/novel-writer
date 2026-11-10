# API

This document describes the stable HTTP API and the optional MCP adapter.

## HTTP Runtime API

Default local endpoint:

```text
http://127.0.0.1:5701
```

Override with:

```text
FANQIE_SERVICE_HOST
FANQIE_SERVICE_PORT
PORT
FANQIE_SERVICE_ROOT
FANQIE_SERVICE_DATA_DIR
FANQIE_CONTENTBASE_ROOT
FANQIE_BROWSER_EXECUTABLE
FANQIE_DATABASE_MYSQL_HOST
FANQIE_DATABASE_MYSQL_PORT
FANQIE_DATABASE_MYSQL_DATABASE
FANQIE_DATABASE_MYSQL_USER
FANQIE_DATABASE_MYSQL_PASSWORD
```

On Railway, leave `FANQIE_SERVICE_HOST` and `FANQIE_SERVICE_PORT` unset unless
there is a specific reason to override them. The service will listen on
`0.0.0.0:$PORT`.

All successful HTTP responses use:

```json
{ "success": true, "data": {} }
```

Failures use:

```json
{ "success": false, "code": "error_code", "error": "message" }
```

Routes:

```text
GET  /health
GET  /accounts
POST /accounts/:id/login
POST /accounts/:id/session/check
POST /works/scan
POST /chapters/remote/sync
POST /publish/chapter
POST /publish/tomato
POST /publish/database-chapter
GET  /publish/jobs/:jobId
GET  /database/publication-targets
GET  /database/fanqie-works
GET  /database/publish-context
GET  /database/publish-chapter
```

ContentBase should normally call these routes through `HttpFanqieClient`, not
by constructing HTTP requests in product code.

## MCP Adapter

The current MCP transport is stdio:

```powershell
pnpm run dev:mcp
```

stdio MCP has no port. HTTP MCP endpoints such as `/mcp`, `/sse`, or
`/messages` are not implemented yet.

The MCP adapter exposes schema-first tools:

```text
account.list
account.login
account.session.check
work.scan
chapter.remote.sync
publish.chapter
publish.database.chapter
publish.job.get
database.publication.targets
database.fanqie.works
database.publish.context
database.publish.chapter
```

Tool handlers call the same application layer as HTTP routes. They are an
agent-facing projection, not a separate publish runtime.

## Driver State

The default container wires `ScriptFanqiePlatformDriver`, which runs the
Playwright browser runtime scripts under `src/runtime/browser`.

Implemented real browser-backed operations:

```text
POST /accounts/:id/login
POST /accounts/:id/session/check
POST /works/scan
POST /chapters/remote/sync
```

Non-dry-run publish runs the Playwright create-chapter flow and then reloads the
remote chapter list to confirm the requested chapter number exists. If
confirmation fails, the publish job is marked failed and stores the driver
error/evidence.

Dry-run publish creates a local publish job without touching Fanqie.

`POST /publish/tomato` is a Dify-friendly semantic alias for
`POST /publish/chapter`. It uses the same request body, application use case,
job repository, browser driver, and platform confirmation evidence. Dify may
call this route as an HTTP tool, but it must not own Fanqie cookies, sessions,
selectors, or browser state.

`POST /publish/database-chapter` is the DataBase-backed atomic publish entry.
It resolves the selected account/book/work/chapter into the same payload accepted
by `POST /publish/chapter`, then executes the publish atom. It does not perform
publish eligibility, scheduling, or business gate decisions.

DataBase is treated as a read/write data service. The service must not use
DataBase rows as fixed machine-local file path registries. Browser profiles,
screenshots, and job files are runtime artifacts owned by fanqie-service only.

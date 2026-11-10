# fanqie-service

External Fanqie platform execution service for ContentBase.

This repository is a reference implementation for the Fanqie boundary. The
important rule is simple: Fanqie is an external platform executor, not the
business core of ContentBase.

## Boundary

```text
ContentBase
  owns:
    - work and chapter truth
    - publish eligibility
    - publish gates
    - workflow state
    - scheduling decisions

  depends on:
    - FanqieClient SDK

fanqie-service
  owns:
    - Fanqie accounts
    - sessions and browser profiles
    - login and session checks
    - remote work/chapter scans
    - publish browser automation
    - platform confirmation evidence
```

ContentBase sends commands and receives evidence. It must not import
Playwright, cookies, browser profile paths, selectors, page buttons, or Fanqie
backstage details.

## Runtime Model

The mature shape is:

```text
Core Runtime
  -> HTTP API
  -> TypeScript SDK
  -> optional MCP adapter
```

## Railway Deployment

Railway should deploy this repository directly from GitHub. The service auto
binds to `0.0.0.0:$PORT` when Railway provides `PORT`.

Required Railway variables:

```text
DATABASE_GATEWAY_URL=https://database.example.invalid
FANQIE_SERVICE_DATA_DIR=/app/.runtime/fanqie-service
```

Do not put Fanqie account passwords, cookies, or browser profile paths in Dify.
Fanqie session data belongs to DataBase and fanqie-service runtime only.

For this project, that means:

```text
ContentBase
  -> FanqieClient SDK
  -> HTTP API
  -> application use cases
  -> runtime queue / locks / session / browser
  -> Fanqie web drivers
  -> Fanqie platform

Agent clients
  -> MCP stdio adapter
  -> same application use cases
  -> same runtime and drivers
```

MCP is a tool exposure layer. It is not the source of workflow truth and it is
not where browser lifecycle, queues, locks, retries, or page state should live.

## Source Layout

```text
src/
  application/
    account/
    publish/
    chapter/
    scan/

  api/
    http/
    protocol/

  sdk/
    client.ts
    types.ts
    errors.ts

  mcp/
    server.ts
    protocol/
    tool-registry/
    transport/

  runtime/
    browser/
    session/
    queue/
    locks/

  domain/
    account/
    chapter/
    confirmation/
    publish/
    session/
    work/

  drivers/
    fanqie/
      login-driver/
      publish-driver/
      scan-driver/

  infrastructure/
    database/
    reader/
```

## Why These Layers Exist

`src/application` contains use cases such as account management, session check,
remote scan, and publish. These classes orchestrate runtime and drivers, but
they do not define ContentBase workflow truth.

`src/api/http` is the stable process boundary for ContentBase and normal
services. It should stay thin: parse request, call application, return a stable
response shape.

`src/sdk` is what ContentBase should use. ContentBase should depend on
`FanqieClient`, not on route strings or browser implementation details.

`src/mcp` adapts the same application layer into MCP tools for agent clients.
The stdio transport has no HTTP port. If HTTP MCP is added later, it should
remain another transport adapter, not a new business path.

`src/runtime` owns mutable execution state: browser runtime, browser profiles,
session summaries, queues, and account locks. Tools and routes issue commands;
runtime owns state.

`src/drivers/fanqie` is the only layer that should know Fanqie pages, selectors,
buttons, timing quirks, and publish confirmation mechanics.

`src/domain` contains the stable account, chapter, confirmation, publish,
session, and work types shared across the application, API, SDK, MCP, and
drivers.

`src/infrastructure` contains replaceable external adapters. `database/` talks
to DataBase Gateway publication surfaces, while `reader/` reads public Fanqie
pages. Do not add future adapter folders until a real runtime owner exists.

## HTTP API

HTTP is the primary runtime API. The default bind is:

```text
FANQIE_SERVICE_HOST=127.0.0.1
FANQIE_SERVICE_PORT=5701
```

Routes:

```text
GET  /health

GET  /accounts
POST /accounts/login/discover
POST /accounts/:id/login
POST /accounts/:id/session/check
POST /accounts/:id/reauth

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

Current implementation state:

| Capability | Status |
| --- | --- |
| `GET /health` | implemented; reports active driver name. |
| account list | implemented through DataBase account/session truth. |
| account login discovery | implemented; opens Fanqie login without a preselected account id, waits for operator login, identifies the logged-in account, persists cookies to DataBase, and closes the browser. |
| login launch | implemented through Playwright/Chrome profile script. |
| session check | implemented through Playwright book-manage probe. |
| account reauth | implemented; checks session, runs headed login to completion when needed, persists cookies, then verifies again. |
| works scan | implemented through Playwright remote works scan. |
| remote chapter sync | implemented through Playwright chapter-manage scan. |
| publish dry-run | implemented. |
| real publish submit | implemented through Playwright create-chapter flow and remote chapter confirmation. |
| `POST /publish/tomato` | implemented as a platform-named alias over the same publish use case. |
| DataBase chapter publish | implemented; resolves account/book/chapter content from DataBase, then runs one publish atom. |

The canonical account and session source is DataBase:

- `fanqie_accounts` owns the stable account identity and operator-facing name.
- `fanqie_account_sessions` owns the Playwright-compatible cookie JSON payload.
- DataBase values must be data payloads, not machine-local file paths. The
  service reads account/session/chapter data when needed and writes refreshed
  cookies back as database payloads.

The browser profile directory is only a runtime cache. By default it is created
under the OS temp directory and can be discarded after execution. The service
does not require ContentBase cookie files or browser profile paths to run.

## SDK

```ts
import { HttpFanqieClient } from '@emptyinkpot/fanqie-service';

const client = new HttpFanqieClient({
  baseUrl: 'http://127.0.0.1:5701',
});

const health = await client.health();
```

The SDK owns HTTP details for callers. Product code should depend on the
`FanqieClient` interface.

For DataBase-backed publishing, callers can select the exact account, remote
book, local work, and chapter. The service does not decide whether the chapter
should be published; upstream workflow code owns eligibility and scheduling.

```ts
await client.publishDatabaseChapter({
  accountId: 'fanqie_52d5ff1c9614',
  bookId: '7605503463933365310',
  localWorkId: 11,
  chapterNumber: 76,
  waitForCompletion: true,
});
```

## MCP Adapter

The MCP entrypoint is local stdio:

```powershell
pnpm run dev:mcp
```

There is no MCP port in stdio mode. Agent clients communicate over
stdin/stdout. HTTP MCP is intentionally not implemented yet.

Current MCP tools:

```text
account.list
account.login
account.session.check
account.reauth
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

MCP tools are schema-first and call the application layer. They must not hold
browser pages, cookies, sessions, or ContentBase workflow state.

## Development

```powershell
pnpm install
pnpm run check
pnpm run dev
pnpm run dev:mcp
```

`pnpm run dev` starts the HTTP runtime API. `pnpm run dev:mcp` starts the MCP
stdio adapter.

Default runtime data is stored under `.runtime/fanqie-service/`. Do not commit
runtime state, cookies, browser profiles, screenshots, logs, or local operator
data.

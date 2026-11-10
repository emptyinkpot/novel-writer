---
title: Fanqie Service Architecture
status: canonical
---

# Fanqie Service Architecture

`fanqie-service` is an external platform executor. It is not a content or
workflow source of truth.

## Canonical Execution Chain

The service has one primary business chain:

```text
ContentBase
  -> FanqieClient SDK
  -> HTTP API
  -> application use case
  -> runtime queue / locks / session / browser
  -> Fanqie web driver
  -> Fanqie platform
  -> confirmation evidence
```

MCP is an adapter over that chain:

```text
MCP stdio client
  -> src/mcp transport and tool registry
  -> application use case
  -> same runtime and drivers
```

The MCP adapter exists for agents and tools. It must not become a second
publish implementation.

## Ownership

| Layer | Owns |
| --- | --- |
| ContentBase | work/chapter truth, publish eligibility, publish gate, workflow state, scheduling |
| fanqie-service | accounts, sessions, browser profiles, platform scans, publish actions, confirmation evidence |

## Source Layers

| Path | Responsibility |
| --- | --- |
| `src/application` | Account, session, scan, chapter, and publish use cases. |
| `src/api/http` | HTTP runtime API routes. No browser or platform logic. |
| `src/api/protocol` | HTTP contracts and route/tool catalog metadata. |
| `src/sdk` | ContentBase-facing TypeScript client and stable types. |
| `src/mcp` | MCP protocol schemas, tool registration, and stdio transport adapter. |
| `src/runtime` | Browser profile resolution, session state, queues, and account locks. |
| `src/domain` | Stable account, chapter, confirmation, publish, session, and work types shared across layers. |
| `src/drivers/fanqie` | Fanqie web page drivers, selectors, and platform confirmation mechanics. |
| `src/infrastructure/database` | DataBase Gateway publication-target, chapter, and result adapters. |
| `src/infrastructure/reader` | Public Fanqie reader-page hydration adapters. |
| `docs/fanqie-publish-fsm.mmd` | Dynamic publish FSM evidence map for the canonical execution chain. |

## Layer Rules

- ContentBase must not import Playwright, cookies, browser profile paths, or
  Fanqie page-level details.
- HTTP routes and MCP tools must call `src/application`; they must not directly
  drive browser pages.
- Runtime state lives in `src/runtime`, not in MCP tool handlers or route
  handlers.
- Fanqie selectors, buttons, URL assumptions, and waiting logic live only under
  `src/drivers/fanqie`.
- Publish completion requires platform confirmation evidence, not only a
  clicked submit button.
- The service must return explicit failure when the Fanqie platform driver is
  not configured.
- Runtime state under `.runtime/` is local service state and must not be
  committed.

## API Contract

The stable ContentBase boundary is HTTP plus the TypeScript SDK in `src/sdk`.

The default HTTP runtime endpoint is:

```text
http://127.0.0.1:5701
```

The MCP boundary is an agent-facing projection of the same application layer:

```text
pnpm run dev:mcp
```

stdio MCP has no port. HTTP MCP is not part of the current contract.

## Capability Granularity

Prefer granular platform capabilities where a model or operator needs stepwise
control:

```text
publish.open_work
publish.upload_chapter
publish.submit_publish
publish.check_publish_result
```

Keep `publish.chapter` as a compatibility command for callers that need a full
single-step publish job. Do not make it the only internal capability shape.

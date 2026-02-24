# Story 1.2: Webhook Server & API Key Authentication

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want the plugin to expose a secure webhook server that rejects unauthenticated requests,
so that only my authorized voice-app can communicate with the plugin.

## Acceptance Criteria

1. **Given** the plugin config specifies `webhookPort: 47334` and `apiKey: "test-key"`
   **When** the plugin starts
   **Then** an Express HTTP server listens on port 47334 and logs `[sip-voice] webhook server listening on port 47334`

2. **Given** a request arrives at any plugin endpoint without an `Authorization` header
   **When** the auth middleware processes the request
   **Then** the server returns HTTP 401 with no further processing (no agent invocation)

3. **Given** a request arrives with `Authorization: Bearer wrong-key`
   **When** the auth middleware processes the request
   **Then** the server returns HTTP 401

4. **Given** a request arrives with `Authorization: Bearer test-key`
   **When** the auth middleware processes the request
   **Then** the request is passed through to the route handler

5. **Given** the webhook server is running
   **When** a GET request is sent to `/voice/health`
   **Then** the server returns HTTP 200 with body `{ "ok": true }`

6. **Given** the plugin includes `src/session-store.js` with an in-memory Map
   **When** the plugin starts
   **Then** the session store is initialized as an empty Map and any stale sessions from prior runs are cleared

## Tasks / Subtasks

- [x] Task 1: Create `openclaw-plugin/src/auth.js` — Bearer token auth middleware (AC: #2, #3, #4)
  - [x] Export Express middleware function that reads `Authorization` header
  - [x] Extract Bearer token and compare against configured `apiKey`
  - [x] Return 401 JSON response `{ "error": "unauthorized" }` for missing/invalid token
  - [x] Call `next()` only when token matches
  - [x] Log auth failures at WARN level (without including the token value)
  - [x] Accept `apiKey` via constructor/factory pattern (not hardcoded, not from env — from plugin config)

- [x] Task 2: Create `openclaw-plugin/src/session-store.js` — In-memory session Map (AC: #6)
  - [x] Export `create(callId, sessionId)`, `get(callId)`, `remove(callId)`, `clear()`, `size()` methods
  - [x] Internal state: `new Map()` keyed by `callId` (string, UUID v4 format)
  - [x] `clear()` called on startup to handle stale sessions from prior gateway runs
  - [x] No persistence — Map is ephemeral (matches OpenClaw bug #3290 constraint)
  - [x] CommonJS exports only

- [x] Task 3: Create `openclaw-plugin/src/webhook-server.js` — Express HTTP server (AC: #1, #5)
  - [x] Export `createServer(config)` factory that returns an Express app (not auto-listening)
  - [x] Export `startServer(app, port)` that calls `app.listen(port)` and returns the HTTP server instance
  - [x] Apply auth middleware to all `/voice/*` routes EXCEPT `/voice/health` (health is unauthenticated)
  - [x] Register `GET /voice/health` → responds 200 `{ "ok": true }`
  - [x] Register route stubs for `POST /voice/query` and `POST /voice/end-session` (return 501 — implemented in Story 1.3)
  - [x] Use `express.json()` body parser
  - [x] Log `[sip-voice] webhook server listening on port <port>` at INFO on successful start
  - [x] No synchronous I/O — all handlers async

- [x] Task 4: Integrate webhook server into plugin lifecycle via `src/index.js` (AC: #1)
  - [x] In `activate(api)`, after channel registration, call `createServer(config)` and `startServer(app, port)`
  - [x] Pass `apiKey` from `api.getConfig()` to auth middleware
  - [x] Pass `webhookPort` from config (default: 47334)
  - [x] Store server reference for future graceful shutdown
  - [x] Clear session store on startup (stale call reaper pattern)

- [x] Task 5: Write tests for all new modules (AC: #1–#6)
  - [x] `test/auth.test.js` — auth middleware unit tests (missing header, wrong token, correct token, Bearer prefix handling)
  - [x] `test/session-store.test.js` — session store CRUD + clear + size
  - [x] `test/webhook.test.js` — Express supertest-style tests (health endpoint, auth enforcement, 501 stubs)

## Dev Notes

### CRITICAL: Auth Middleware Must Block Before Processing

Per NFR-S5 and architecture.md#Authentication & Security: `Return HTTP 401 for requests missing a valid API key, before any agent invocation`. The auth middleware MUST be the first middleware on protected routes — before body parsing logic, before session lookup, before any OpenClaw interaction. AC #2 explicitly states "no further processing."

Auth check must NOT log the API key itself at any level (NFR-S2).

[Source: architecture.md#Authentication & Security]
[Source: epics.md#Story 1.2 AC #2]

### Health Endpoint Is Unauthenticated

The `/voice/health` endpoint is used by voice-app for liveness checks. It must NOT require auth — the voice-app calls this to determine if the plugin is reachable (used by `isAvailable()` in `openclaw-bridge.js`). If health required auth, a misconfigured API key would make the plugin appear down rather than misconfigured.

[Source: architecture.md#API & Communication Patterns]
[Source: epics.md#Story 1.4 — isAvailable() calls GET /voice/health]

### Session Store: In-Memory Map Only

No persistence. OpenClaw bug #3290 clears `chatRunState` on gateway restart, making persistent session storage valueless. The Map is cleared on plugin startup (stale call reaper pattern from voice-call extension).

Key format: `callId` = drachtio `callUuid` (UUID v4, lowercase, hyphenated). Never transform or hash it.

[Source: architecture.md#Data Architecture]
[Source: architecture.md#Session Key Format]

### Express App Factory Pattern

`createServer(config)` returns an Express app without calling `.listen()`. This enables:
1. Tests can use supertest/inject without binding a port
2. `startServer(app, port)` is a separate step, called from `index.js`
3. Graceful shutdown: store the `http.Server` reference returned by `.listen()`

This pattern was established by the voice-app's existing Express usage.

[Source: architecture.md#Implementation Patterns]

### Webhook Route Stubs for Story 1.3

Story 1.2 creates the server infrastructure. The actual `/voice/query` and `/voice/end-session` business logic is implemented in Story 1.3. Story 1.2 should register these routes as stubs returning 501 Not Implemented, so the server structure is complete and Story 1.3 only needs to fill in the handlers.

[Source: epics.md#Story 1.3]

### Auth Middleware Design: Factory Pattern

The auth middleware should accept `apiKey` as a parameter (factory/closure pattern), NOT read from `process.env` directly. The API key comes from `api.getConfig().apiKey` (OpenClaw plugin config YAML), not from environment variables on the plugin side.

```js
// CORRECT — apiKey from plugin config
function createAuthMiddleware(apiKey) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ') || header.slice(7) !== apiKey) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}

// WRONG — reading from env (that's voice-app side, not plugin side)
const apiKey = process.env.OPENCLAW_API_KEY;
```

[Source: architecture.md#Authentication & Security]
[Source: openclaw-plugin/src/index.js — api.getConfig() pattern from Story 1.1]

### Logging Discipline

All log lines must use the existing `logger.js` from Story 1.1 (already enforces `[sip-voice]` prefix).

For auth failures: log at WARN level with callsite context (endpoint, method) but NEVER include the submitted token or the configured API key.

```js
// CORRECT
logger.warn('auth failed: missing or invalid token', { method: req.method, path: req.path });

// WRONG — leaks the token
logger.warn('auth failed', { token: req.headers.authorization });
```

[Source: architecture.md#Logging Rules]
[Source: openclaw-plugin/src/logger.js — already implemented in Story 1.1]

### Module System: CommonJS Only

All new files must use `require()`/`module.exports`. No ESM. This is enforced by the drachtio ecosystem constraint.

```js
// CORRECT
const express = require('express');
module.exports = { createServer, startServer };

// WRONG
import express from 'express';
export { createServer, startServer };
```

[Source: architecture.md#Module System Rules]

### Async Discipline: No Blocking I/O

All Express handlers must be async. No `fs.readFileSync` or other sync I/O anywhere in the plugin. The plugin runs inside the OpenClaw gateway event loop — one blocking call stalls ALL agents.

[Source: architecture.md#Async Rules]

### Testing Pattern from Story 1.1

Tests use Node.js built-in test runner (`node:test` + `node:assert`). Key patterns:
- Module cache clearing: `delete require.cache[require.resolve('../src/module')]` for isolation
- Console capture: replace `console.log`/`console.warn` to verify log output
- Mock API objects with `_calls` tracking

For webhook tests, since `supertest` is not a dependency, test the Express app by:
1. Creating the app via `createServer(config)`
2. Using Node.js built-in `http` module to make requests against a test server
3. Or importing the middleware/handlers directly and testing with mock req/res objects

Note: If adding `supertest` as a devDependency, it must be pure JS (no native deps per NFR-I4).

[Source: openclaw-plugin/test/index.test.js — pattern reference]
[Source: openclaw-plugin/package.json — express ^4 already a dependency]

### Integration with index.js (Story 1.1 Code)

Current `index.js` exports `{ activate, getConfig }`. Story 1.2 must modify `activate()` to:
1. After `api.registerChannel()`, create and start the webhook server
2. Pass config (`apiKey`, `webhookPort`) from `pluginConfig`
3. Clear session store on startup

The `getConfig()` accessor remains unchanged — already returns a shallow copy.

```js
// In activate(api), after registerChannel:
const sessionStore = require('./session-store');
const { createServer, startServer } = require('./webhook-server');

sessionStore.clear(); // Stale call reaper

const app = createServer({ apiKey: pluginConfig.apiKey });
const port = pluginConfig.webhookPort || 47334;
await startServer(app, port);
```

[Source: openclaw-plugin/src/index.js — current implementation]

### Error Handling: Server Start Failure

If `app.listen(port)` fails (port in use, permission denied), the error must be:
1. Logged at ERROR level with `[sip-voice]` prefix
2. Propagated (rethrown) so OpenClaw gateway knows the plugin failed to activate
3. The plugin should NOT crash silently — a webhook server that isn't listening is a non-functional plugin

This follows the same error pattern established in Story 1.1's `activate()` try/catch.

[Source: openclaw-plugin/src/index.js — activate() error handling pattern]

### HTTP Response Bodies

Consistent JSON response format across all endpoints:

| Endpoint | Success | Auth Failure |
|---|---|---|
| `GET /voice/health` | `{ "ok": true }` | N/A (unauthenticated) |
| `POST /voice/query` | (Story 1.3) | `{ "error": "unauthorized" }` |
| `POST /voice/end-session` | (Story 1.3) | `{ "error": "unauthorized" }` |
| Stub routes (1.2) | `{ "error": "not implemented" }` (501) | `{ "error": "unauthorized" }` (401) |

[Source: architecture.md#HTTP Contract]

### Forward Note for Story 1.3

Story 1.3 will replace the stub handlers for `/voice/query` and `/voice/end-session` with actual OpenClaw agent routing logic. The webhook server structure, auth middleware, and session store from this story are the foundation.

Story 1.3 acceptance criteria reference the session store (`callId` → `sessionId` mapping) and the authenticated POST endpoints — both created here.

[Source: epics.md#Story 1.3]

### Project Structure Notes

**Files created/modified in this story:**

```
openclaw-plugin/
├── src/
│   ├── index.js           ← MODIFIED (add webhook server start + session store clear)
│   ├── auth.js            ← NEW (Bearer token auth middleware)
│   ├── session-store.js   ← NEW (in-memory Map)
│   └── webhook-server.js  ← NEW (Express server factory)
└── test/
    ├── auth.test.js       ← NEW
    ├── session-store.test.js ← NEW
    └── webhook.test.js    ← NEW (or webhook-server.test.js)
```

No voice-app changes in Story 1.2.

[Source: architecture.md#Complete Project Directory Structure]

### References

- [Source: epics.md#Story 1.2] — Acceptance criteria and user story statement
- [Source: architecture.md#HTTP Contract] — Exact endpoint specifications and JSON shapes
- [Source: architecture.md#Authentication & Security] — API key auth requirements, 401 before processing
- [Source: architecture.md#Data Architecture] — In-memory Map, stale call reaper pattern
- [Source: architecture.md#Session Key Format] — callId = UUID v4, never transform
- [Source: architecture.md#Async Rules] — No synchronous I/O in plugin
- [Source: architecture.md#Module System Rules] — CommonJS only
- [Source: architecture.md#Logging Rules] — [sip-voice] prefix, PII discipline
- [Source: architecture.md#Implementation Patterns] — Error handling, Express patterns
- [Source: prd.md#NFR-S2] — API key never in logs
- [Source: prd.md#NFR-S5] — 401 before any agent invocation
- [Source: prd.md#NFR-I3] — All operations non-blocking
- [Source: prd.md#NFR-I4] — No native build dependencies
- [Source: openclaw-plugin/src/index.js] — Current activate() pattern from Story 1.1
- [Source: openclaw-plugin/src/logger.js] — Existing logger with [sip-voice] prefix
- [Source: openclaw-plugin/test/index.test.js] — Test patterns (node:test, cache clearing, console capture)
- [Source: 1-1-plugin-scaffold-and-channel-registration.md] — Previous story learnings and review fixes

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation proceeded without blocking issues.

### Completion Notes List

- Implemented `createAuthMiddleware(apiKey)` factory pattern; auth check is the first handler on protected routes before any body processing.
- Health endpoint registered before the `app.use('/voice', auth)` middleware so Express resolves it without ever reaching auth — confirmed by integration tests.
- Session store is a plain module-level `Map`; `clear()` called in `activate()` as the stale-call reaper.
- `startServer` uses `server.address().port` to log the actual bound port (supports port 0 in tests).
- Updated `index.test.js` to inject a mock `webhook-server` into `require.cache` before any `activate()` calls, preventing real port binding in existing tests and preserving the `logLines.length === 1` assertion.
- Lint: only pre-existing `voice-app` warnings remain; `_server` suppressed with inline eslint-disable (intentional forward reference for Story 4.4 graceful shutdown).
- 55 tests total (29 pre-existing + 26 new), all pass; 0 regressions.

### Change Log

- 2026-02-24: Story 1.2 implemented — webhook server, auth middleware, session store, integration into activate() (claude-sonnet-4-6)
- 2026-02-24: Code review fixes — M1: moved express.json() after auth middleware so body parsing is skipped on 401; M2: createAuthMiddleware() throws on empty/undefined apiKey (fail-fast misconfiguration guard); L3: added JSON 404 catch-all handler; 2 new auth tests + 2 new webhook tests; 59 tests total, 0 failures (claude-sonnet-4-6)

### File List

- `openclaw-plugin/src/auth.js` — new
- `openclaw-plugin/src/session-store.js` — new
- `openclaw-plugin/src/webhook-server.js` — new
- `openclaw-plugin/src/index.js` — modified (webhook server start + session store clear)
- `openclaw-plugin/test/auth.test.js` — new
- `openclaw-plugin/test/session-store.test.js` — new
- `openclaw-plugin/test/webhook.test.js` — new
- `openclaw-plugin/test/index.test.js` — modified (inject webhook-server mock for test isolation)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (story status update)

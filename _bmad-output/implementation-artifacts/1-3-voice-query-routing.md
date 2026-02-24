# Story 1.3: Voice Query Routing

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a caller,
I want my spoken words routed to the correct OpenClaw agent and the agent's response returned,
so that I can have a conversation with my agent over the phone.

## Acceptance Criteria

1. **Given** a valid authenticated POST request to `/voice/query` with body `{ "prompt": "hello", "callId": "uuid-1", "accountId": "morpheus", "peerId": "+15551234567" }`
   **When** the webhook server processes the request
   **Then** the plugin routes the query to the OpenClaw agent bound to `accountId` "morpheus", passes `peerId` for caller identity, and returns HTTP 200 with body `{ "response": "<agent reply>" }`

2. **Given** the `callId` is a new UUID not seen before
   **When** the first `/voice/query` request arrives for that `callId`
   **Then** the session store creates a new session mapping (`callId` → `sessionId`) and the OpenClaw agent starts a new session

3. **Given** the `callId` already has an active session in the store
   **When** a subsequent `/voice/query` request arrives with the same `callId`
   **Then** the plugin resumes the existing OpenClaw session (no new session created)

4. **Given** a valid authenticated POST request to `/voice/end-session` with body `{ "callId": "uuid-1" }`
   **When** the webhook server processes the request
   **Then** the session store removes the `callId` mapping and returns HTTP 200 with `{ "ok": true }`
   **And** the OpenClaw agent workspace is NOT terminated (voice-app session only)

5. **Given** the `peerId` (caller phone number) is included in the query
   **When** the plugin logs the request
   **Then** `peerId` appears only at DEBUG level, never at INFO/WARN/ERROR

6. **Given** the OpenClaw agent is unreachable or returns an error
   **When** the plugin attempts to route a query
   **Then** the plugin returns HTTP 503 with `{ "error": "agent unavailable" }` and logs the error at ERROR level with `[sip-voice]` prefix

## Tasks / Subtasks

- [x] Task 1: Implement `POST /voice/query` handler in `webhook-server.js` (AC: #1, #2, #3, #5, #6)
  - [x] Replace 501 stub with real handler that validates required body fields (`prompt`, `callId`, `accountId`)
  - [x] Resolve `accountId` → `agentId` using plugin config `bindings` array
  - [x] Return 400 for missing required fields with `{ "error": "missing required field: <field>" }`
  - [x] Return 404 for unknown `accountId` with `{ "error": "no agent binding for accountId" }`
  - [x] On first query for a `callId`, create a new OpenClaw session via `api` and store `callId` → `sessionId` in session store
  - [x] On subsequent queries, retrieve existing `sessionId` from session store and resume the session
  - [x] Pass `peerId` to OpenClaw agent for caller identity resolution
  - [x] Return `{ "response": "<agent reply>" }` on success (HTTP 200)
  - [x] Catch OpenClaw errors and return HTTP 503 `{ "error": "agent unavailable" }`
  - [x] Log `peerId` at DEBUG only; log `callId` and `accountId` at INFO

- [x] Task 2: Implement `POST /voice/end-session` handler in `webhook-server.js` (AC: #4)
  - [x] Replace 501 stub with real handler that validates `callId` field
  - [x] Return 400 for missing `callId`
  - [x] Remove `callId` → `sessionId` mapping from session store
  - [x] Do NOT terminate the OpenClaw agent workspace (voice-app session cleanup only)
  - [x] Return `{ "ok": true }` on success (HTTP 200)
  - [x] Handle missing `callId` in session store gracefully (log WARN, still return 200)

- [x] Task 3: Thread plugin config (bindings, api reference) into webhook-server.js (AC: #1)
  - [x] Modify `createServer(config)` to accept `bindings`, `accounts`, and an `agentQuery` callback or the OpenClaw `api` object
  - [x] Build a lookup Map from `bindings` for O(1) `accountId` → `agentId` resolution
  - [x] Ensure the session store is imported and used within route handlers

- [x] Task 4: Implement OpenClaw agent query integration (AC: #1, #2, #3, #6)
  - [x] Determine the OpenClaw in-process API for querying agents (the `api` object from `activate()`)
  - [x] Create or resume sessions using `callId` as the correlation key
  - [x] Pass prompt text + peerId + accountId context to the agent
  - [x] Handle agent timeout/failure: catch errors, log at ERROR, return 503
  - [x] All calls async/await — no synchronous I/O

- [x] Task 5: Update `index.js` to pass config to webhook server (AC: #1)
  - [x] Pass `bindings`, `accounts`, and the `api` object (or a query wrapper) to `createServer()`
  - [x] Ensure `pluginConfig.bindings` and `pluginConfig.accounts` are available to route handlers

- [x] Task 6: Write tests for new route handlers (AC: #1–#6)
  - [x] Test `/voice/query` — successful agent query returns 200 with `{ response }`
  - [x] Test `/voice/query` — new callId creates session store entry
  - [x] Test `/voice/query` — existing callId resumes session (no duplicate create)
  - [x] Test `/voice/query` — missing required fields returns 400
  - [x] Test `/voice/query` — unknown accountId returns 404
  - [x] Test `/voice/query` — agent error returns 503
  - [x] Test `/voice/end-session` — removes session and returns `{ ok: true }`
  - [x] Test `/voice/end-session` — missing callId in store still returns 200
  - [x] Test PII discipline: verify `peerId` never appears in INFO/WARN/ERROR logs
  - [x] All tests use `node:test` + `node:assert` (consistent with Story 1.1 and 1.2 patterns)

## Dev Notes

### CRITICAL: This Story Replaces the 501 Stubs from Story 1.2

Story 1.2 created the webhook server infrastructure with stub routes returning 501. Story 1.3 replaces those stubs with actual business logic. The server structure, auth middleware, session store, and Express app factory are all already in place — DO NOT recreate them.

**Stubs to replace in `webhook-server.js` (lines 26-32):**
```js
// Story 1.2 stubs — REPLACE these:
app.post('/voice/query', async (req, res) => {
  res.status(501).json({ error: 'not implemented' });
});
app.post('/voice/end-session', async (req, res) => {
  res.status(501).json({ error: 'not implemented' });
});
```

[Source: openclaw-plugin/src/webhook-server.js lines 26-32]

### OpenClaw Agent Query API

The plugin runs INSIDE the OpenClaw gateway process. The `api` object received in `activate(api)` provides in-process access to OpenClaw's agent system. The exact method for querying agents must be determined from the OpenClaw API — likely via `api.sendMessage()`, `api.queryAgent()`, or similar.

**Key integration points:**
- `api.registerChannel()` — already called in Story 1.1
- Session management — OpenClaw may provide session/conversation APIs
- Agent routing — use `bindings` config to map `accountId` → `agentId`

**If the OpenClaw API does not expose a direct query method**, the plugin may need to use `api.registerGatewayMethod()` to register a handler that receives agent responses, and use a request/response correlation pattern (callId-based).

[Source: architecture.md#Plugin approach: Option B — channel plugin via api.registerChannel()]

### accountId → agentId Binding Resolution

The plugin config contains:
```yaml
bindings:
  - accountId: morpheus
    agentId: morpheus
  - accountId: cephanie
    agentId: cephanie
```

Build a Map on startup for O(1) lookup:
```js
const bindingMap = new Map();
for (const b of config.bindings) {
  bindingMap.set(b.accountId, b.agentId);
}
```

When `/voice/query` arrives with `accountId: "morpheus"`, look up `bindingMap.get("morpheus")` → `"morpheus"` (the agentId). If no binding exists, return HTTP 404.

[Source: openclaw-plugin/openclaw.plugin.json configSchema]
[Source: epics.md#Story 2.2 — agent bindings (detailed implementation in Epic 2, but binding lookup needed here)]

### Session Store Usage Pattern

The session store is already implemented (`src/session-store.js`). Use it in the query handler:

```js
const sessionStore = require('./session-store');

// In /voice/query handler:
let sessionId = sessionStore.get(callId);
if (!sessionId) {
  // First query for this call — create new OpenClaw session
  sessionId = await createOpenClawSession(agentId, peerId);
  sessionStore.create(callId, sessionId);
}
// Resume session with prompt
const response = await queryOpenClawAgent(agentId, sessionId, prompt);
```

Key: `callId` = drachtio `callUuid` (UUID v4, lowercase, hyphenated). NEVER transform or hash it.

[Source: architecture.md#Session Key Format]
[Source: openclaw-plugin/src/session-store.js — already implemented]

### HTTP Contract — Exact JSON Shapes

**POST /voice/query:**
```
Request:  { "prompt": string, "callId": string, "accountId": string, "peerId": string }
Success:  200 { "response": string }
Auth fail: 401 { "error": "unauthorized" }
Bad input: 400 { "error": "missing required field: <field>" }
No binding: 404 { "error": "no agent binding for accountId" }
Agent fail: 503 { "error": "agent unavailable" }
```

**POST /voice/end-session:**
```
Request:  { "callId": string }
Success:  200 { "ok": true }
Auth fail: 401 { "error": "unauthorized" }
Bad input: 400 { "error": "missing required field: callId" }
```

[Source: architecture.md#HTTP Contract (MANDATORY)]

### PII-Safe Logging (MANDATORY)

`peerId` is a caller phone number — it is PII. Log discipline:

```js
// CORRECT — peerId at DEBUG only
logger.debug('voice query received', { callId, accountId, peerId });
logger.info('voice query received', { callId, accountId });

// WRONG — peerId at INFO
logger.info('voice query received', { callId, accountId, peerId });
```

[Source: architecture.md#Logging Rules]
[Source: prd.md#NFR-S3]

### Error Handling Pattern

All Express handlers MUST catch async errors. Never let unhandled rejections propagate:

```js
app.post('/voice/query', async (req, res) => {
  try {
    // ... business logic
    res.json({ response: result });
  } catch (err) {
    logger.error('query failed', { callId: req.body.callId, error: err.message });
    res.status(503).json({ error: 'agent unavailable' });
  }
});
```

[Source: architecture.md#Error Handling Pattern]

### Threading Config into createServer()

Currently `createServer(config)` only receives `{ apiKey }`. Story 1.3 needs to extend this to pass the agent query capability. Options:

**Option A — Pass a query callback:**
```js
const app = createServer({
  apiKey: pluginConfig.apiKey,
  bindings: pluginConfig.bindings,
  queryAgent: async (agentId, sessionId, prompt, peerId) => { /* ... */ }
});
```

**Option B — Pass the api object directly:**
```js
const app = createServer({
  apiKey: pluginConfig.apiKey,
  bindings: pluginConfig.bindings,
  api: api  // The OpenClaw API from activate()
});
```

Option A is preferred (dependency inversion) — it keeps webhook-server.js decoupled from the OpenClaw API shape and makes testing easier (inject a mock callback).

[Source: openclaw-plugin/src/index.js — current createServer({ apiKey }) call]

### Module System: CommonJS Only

All files must use `require()`/`module.exports`. No ESM. No `import`/`export`.

```js
// CORRECT
const sessionStore = require('./session-store');
module.exports = { createServer, startServer };

// WRONG
import sessionStore from './session-store';
export { createServer, startServer };
```

[Source: architecture.md#Module System Rules]

### Async Discipline: No Blocking I/O

All Express handlers must be async. No `fs.readFileSync` or other sync I/O. The plugin runs inside the OpenClaw gateway event loop — one blocking call stalls ALL agents.

[Source: architecture.md#Async Rules]

### Testing Pattern from Story 1.1 and 1.2

Tests use Node.js built-in test runner (`node:test` + `node:assert`). Key patterns:
- Module cache clearing: `delete require.cache[require.resolve('../src/module')]` for isolation
- Console capture: replace `console.log`/`console.warn` to verify log output and PII discipline
- Mock API objects with `_calls` tracking
- HTTP testing: create real test server on port 0 (OS-assigned), make requests with `http` module
- Existing webhook tests in `test/webhook.test.js` test auth and health — extend this file or create `test/query-routing.test.js`

[Source: openclaw-plugin/test/webhook.test.js — existing pattern]
[Source: openclaw-plugin/test/index.test.js — mock injection pattern]

### Forward Compatibility: Story 1.4 (Bridge + Loader)

Story 1.4 creates `openclaw-bridge.js` in voice-app that POSTs to these endpoints. The bridge will send:
- `POST /voice/query` with `{ prompt, callId, accountId, peerId }`
- `POST /voice/end-session` with `{ callId }`
- `GET /voice/health` (already working from Story 1.2)

The bridge reads `BRIDGE_TYPE`, `OPENCLAW_WEBHOOK_URL`, `OPENCLAW_API_KEY` from env. Story 1.3 only implements the plugin side (receiving end). The bridge `query()` signature is `query(prompt, { callId, devicePrompt, timeout })` — Story 1.4 maps `deviceConfig.accountId` and caller ID into the POST body.

[Source: voice-app/lib/claude-bridge.js — exact interface to match]
[Source: epics.md#Story 1.4]

### Project Structure Notes

**Files modified in this story:**

```
openclaw-plugin/
├── src/
│   ├── index.js           ← MODIFIED (pass bindings + query callback to createServer)
│   └── webhook-server.js  ← MODIFIED (replace 501 stubs with real handlers)
└── test/
    └── webhook.test.js    ← MODIFIED (add query routing + end-session tests)
    └── (or new test/query-routing.test.js)
```

No new files expected — this story fills in the existing server skeleton.
No voice-app changes in Story 1.3.

[Source: architecture.md#Complete Project Directory Structure]

### References

- [Source: epics.md#Story 1.3] — Acceptance criteria and user story statement
- [Source: architecture.md#HTTP Contract] — Exact endpoint specifications and JSON shapes
- [Source: architecture.md#Session Key Format] — callId = UUID v4, never transform
- [Source: architecture.md#Error Handling Pattern] — try/catch in all route handlers, 503 on failure
- [Source: architecture.md#Logging Rules] — [sip-voice] prefix, PII at DEBUG only
- [Source: architecture.md#Module System Rules] — CommonJS only
- [Source: architecture.md#Async Rules] — No synchronous I/O in plugin
- [Source: architecture.md#Authentication & Security] — API key auth (already in place from Story 1.2)
- [Source: architecture.md#Data Architecture] — In-memory Map, session lifecycle
- [Source: prd.md#FR21-FR24] — Plugin integration requirements
- [Source: prd.md#FR9] — peerId passing
- [Source: prd.md#NFR-S3] — Caller phone numbers at DEBUG only
- [Source: prd.md#NFR-I3] — All operations non-blocking
- [Source: openclaw-plugin/src/webhook-server.js] — Current stubs (lines 26-32)
- [Source: openclaw-plugin/src/session-store.js] — Session store API (create, get, remove, clear, size)
- [Source: openclaw-plugin/src/index.js] — activate() with api object, createServer() call
- [Source: openclaw-plugin/src/logger.js] — Logger with [sip-voice] prefix and DEBUG gating
- [Source: voice-app/lib/claude-bridge.js] — Bridge interface reference (query, endSession, isAvailable)
- [Source: 1-2-webhook-server-and-api-key-authentication.md] — Previous story learnings and patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Replaced 501 stubs in webhook-server.js with full /voice/query and /voice/end-session handlers
- Used dependency inversion: index.js passes a `queryAgent` callback to createServer() rather than the raw OpenClaw `api` object, keeping webhook-server.js decoupled and testable
- Built O(1) bindingMap from config.bindings array for accountId → agentId resolution
- Session store integration: callId used as both key and sessionId for correlation
- PII discipline enforced: peerId logged at DEBUG only, excluded from INFO/WARN/ERROR
- End-session handles missing callId gracefully (WARN log, still returns 200)
- All 70 plugin tests pass (18 new tests added, existing tests updated from 501 stubs to real assertions)
- 0 lint errors (12 pre-existing warnings in voice-app, none in plugin)

### Change Log

- 2026-02-24: Story 1.3 implementation — voice query routing and end-session handlers

### File List

- openclaw-plugin/src/webhook-server.js (modified — replaced 501 stubs with /voice/query and /voice/end-session handlers)
- openclaw-plugin/src/index.js (modified — passes bindings + queryAgent callback to createServer)
- openclaw-plugin/test/webhook.test.js (modified — replaced stub tests with 18 new route handler tests)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — status updated)
- _bmad-output/implementation-artifacts/1-3-voice-query-routing.md (modified — task checkboxes, dev record, status)

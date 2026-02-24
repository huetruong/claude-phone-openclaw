# Story 1.4: OpenClaw Bridge & Bridge Loader

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want to switch from the Claude bridge to the OpenClaw bridge via a single env var,
so that my existing voice-app routes calls through OpenClaw instead of Claude CLI.

## Acceptance Criteria

1. **Given** `voice-app/lib/openclaw-bridge.js` exists and exports `{ query, endSession, isAvailable }`
   **When** the bridge module is loaded
   **Then** the exported interface is identical to `claude-bridge.js` — same method names, same parameter signatures: `query(prompt, options)`, `endSession(callId)`, `isAvailable()`

2. **Given** `BRIDGE_TYPE=openclaw`, `OPENCLAW_WEBHOOK_URL=http://host:3334`, and `OPENCLAW_API_KEY=test-key` are set in the environment
   **When** `query(prompt, options)` is called with `options = { callId, devicePrompt, accountId, peerId }`
   **Then** the bridge sends `POST /voice/query` to `OPENCLAW_WEBHOOK_URL` with body `{ "prompt": prompt, "callId": options.callId, "accountId": options.accountId, "peerId": options.peerId }`, `Authorization: Bearer <OPENCLAW_API_KEY>`, and returns the agent's response string

3. **Given** `BRIDGE_TYPE=openclaw` is set
   **When** `endSession(callId)` is called
   **Then** the bridge sends `POST /voice/end-session` to `OPENCLAW_WEBHOOK_URL` with body `{ "callId": callId }` and `Authorization: Bearer <OPENCLAW_API_KEY>`

4. **Given** `BRIDGE_TYPE=openclaw` is set
   **When** `isAvailable()` is called
   **Then** the bridge sends `GET /voice/health` to `OPENCLAW_WEBHOOK_URL` with `Authorization: Bearer <OPENCLAW_API_KEY>` and returns `true` if HTTP 200, `false` otherwise

5. **Given** the voice-app bridge loader reads `BRIDGE_TYPE` from the environment
   **When** `BRIDGE_TYPE=openclaw`
   **Then** `openclaw-bridge.js` is loaded via `require('./lib/openclaw-bridge')`
   **And** when `BRIDGE_TYPE=claude` (or unset), `claude-bridge.js` is loaded (existing behavior preserved)

6. **Given** the bridge uses CommonJS (`require`/`module.exports`) and all HTTP calls are async
   **When** loaded in the voice-app process
   **Then** no synchronous I/O occurs and the existing STT/TTS pipeline (FR14, FR15) continues to function unchanged

## Tasks / Subtasks

- [x] Task 1: Create `voice-app/lib/openclaw-bridge.js` (AC: #1, #2, #3, #4, #6)
  - [x] Export `{ query, endSession, isAvailable }` — IDENTICAL method names to `claude-bridge.js`
  - [x] Read `OPENCLAW_WEBHOOK_URL` and `OPENCLAW_API_KEY` from `process.env` at module load time
  - [x] `query(prompt, options)`: Extract `callId`, `accountId`, `peerId` from `options`; POST to `/voice/query` with `{ prompt, callId, accountId, peerId }` and `Authorization: Bearer <key>`; return the `response` string from the JSON body
  - [x] `endSession(callId)`: POST to `/voice/end-session` with `{ callId }` and auth header; non-critical, log warn on failure
  - [x] `isAvailable()`: GET `/voice/health` with auth header; return `true` if 200, `false` otherwise
  - [x] Use `axios` for HTTP (consistent with `claude-bridge.js` which already depends on it)
  - [x] Handle connection errors gracefully — return user-friendly error messages from `query()` (matching claude-bridge.js pattern: ECONNREFUSED, ETIMEDOUT, etc.)
  - [x] Handle HTTP 503 from plugin — return unavailability message string
  - [x] All operations async/await — no sync I/O
  - [x] CommonJS: `require`/`module.exports` only

- [x] Task 2: Implement bridge loader in `voice-app/index.js` (AC: #5)
  - [x] Replace hardcoded `var claudeBridge = require("./lib/claude-bridge")` (line 19) with dynamic bridge selection
  - [x] Read `BRIDGE_TYPE` from `process.env` — default to `'claude'` if unset
  - [x] `const bridge = require(\`./lib/${bridgeType}-bridge\`)` — one env var, one require() line
  - [x] Validate `BRIDGE_TYPE` value — only allow `'claude'` or `'openclaw'`; throw on invalid value to fail fast
  - [x] Log selected bridge type at startup: `[BRIDGE] Using ${bridgeType} bridge`
  - [x] Ensure the `claudeBridge` variable name is preserved throughout index.js (rename is unnecessary; the variable name is an internal label, not a contract)

- [x] Task 3: Update `.env.example` with bridge configuration variables (AC: #2, #5)
  - [x] Add `BRIDGE_TYPE` section with `claude` (default) and `openclaw` options documented
  - [x] Add `OPENCLAW_WEBHOOK_URL` with example value
  - [x] Add `OPENCLAW_API_KEY` with placeholder

- [x] Task 4: Write tests for `openclaw-bridge.js` (AC: #1–#6)
  - [x] Test `query()` — successful response returns agent reply string
  - [x] Test `query()` — sends correct JSON body with prompt, callId, accountId, peerId
  - [x] Test `query()` — sends Authorization header with Bearer token
  - [x] Test `query()` — connection refused returns friendly error message (not throw)
  - [x] Test `query()` — timeout returns friendly error message (not throw)
  - [x] Test `query()` — HTTP 503 returns unavailability message (not throw)
  - [x] Test `query()` — missing optional fields (accountId, peerId) handled gracefully
  - [x] Test `endSession()` — sends POST to correct endpoint with callId
  - [x] Test `endSession()` — does not throw on failure (warns only)
  - [x] Test `endSession()` — no-op when callId is falsy
  - [x] Test `isAvailable()` — returns true on 200
  - [x] Test `isAvailable()` — returns false on network error
  - [x] Test `isAvailable()` — returns false on non-200 response
  - [x] All tests use `node:test` + `node:assert` (consistent with Stories 1.1–1.3)
  - [x] Mock HTTP with a real test server on port 0 (OS-assigned) — do NOT mock axios internals

- [x] Task 5: Write tests for bridge loader logic (AC: #5)
  - [x] Test that `BRIDGE_TYPE=openclaw` loads `openclaw-bridge`
  - [x] Test that `BRIDGE_TYPE=claude` loads `claude-bridge`
  - [x] Test that unset `BRIDGE_TYPE` defaults to `claude-bridge`
  - [x] Test that invalid `BRIDGE_TYPE` value throws a clear error

## Dev Notes

### CRITICAL: Bridge Query Signature — Match ACTUAL Codebase, NOT Epics

The epics document `query(prompt, callId, deviceConfig)` (3 positional args), but the **actual codebase** uses `query(prompt, options)` (2 args) where `options` is an object. Both callers confirm this:

**sip-handler.js:222-224:**
```js
const claudeResponse = await claudeBridge.query(
  transcript,
  { callId: callUuid, devicePrompt: devicePrompt }
);
```

**conversation-loop.js:359-362:**
```js
const claudeResponse = await claudeBridge.query(
  transcript,
  { callId: callUuid, devicePrompt: devicePrompt }
);
```

**claude-bridge.js:19-20 (the interface to match):**
```js
async function query(prompt, options = {}) {
  const { callId, devicePrompt, timeout = 30 } = options;
```

The `openclaw-bridge.js` MUST accept `query(prompt, options)` and destructure `{ callId, devicePrompt, accountId, peerId, timeout }` from options. Currently `accountId` and `peerId` are NOT passed by callers — Story 2.1 will add `accountId` to device config and modify callers. For now, the bridge must handle these fields being `undefined` gracefully (omit from POST body if missing).

[Source: voice-app/lib/claude-bridge.js:19-20 — actual query signature]
[Source: voice-app/lib/sip-handler.js:222-224 — actual call site]
[Source: voice-app/lib/conversation-loop.js:359-362 — actual call site]

### Bridge Return Value: String, NOT Object

`claude-bridge.js:query()` returns a **string** (the response text), NOT `{ response: string }`. The plugin returns `{ response: "..." }` over HTTP, but the bridge must unwrap it:

```js
// CORRECT — match claude-bridge.js return type
const data = response.data; // { response: "agent reply" }
return data.response;        // return the string

// WRONG — would break conversation-loop.js
return data;                 // returns object, but callers expect string
```

`conversation-loop.js:382` passes the bridge return directly to `extractVoiceLine(claudeResponse)` which expects a string.

[Source: voice-app/lib/claude-bridge.js:49 — `return response.data.response`]
[Source: voice-app/lib/conversation-loop.js:382 — `extractVoiceLine(claudeResponse)`]

### Bridge Loader: Minimal Change to index.js

The bridge loader is a 3-line change in `voice-app/index.js`. Replace line 19:

**Current (line 19):**
```js
var claudeBridge = require("./lib/claude-bridge");
```

**New:**
```js
var bridgeType = process.env.BRIDGE_TYPE || 'claude';
if (bridgeType !== 'claude' && bridgeType !== 'openclaw') {
  throw new Error('[BRIDGE] Invalid BRIDGE_TYPE: ' + bridgeType + '. Must be "claude" or "openclaw".');
}
var claudeBridge = require('./lib/' + bridgeType + '-bridge');
console.log('[BRIDGE] Using ' + bridgeType + ' bridge');
```

The variable name `claudeBridge` is deliberately kept unchanged — it's referenced in ~10 places throughout `index.js` (lines 205, 215, 246). Renaming it would be unnecessary churn with no functional benefit.

**NOTE:** Do NOT use template literal for `require()` — CommonJS `require()` with template literals works but some linters flag it. Use string concatenation: `require('./lib/' + bridgeType + '-bridge')`.

[Source: voice-app/index.js:19 — current hardcoded require]
[Source: voice-app/index.js:205,215,246 — all references to claudeBridge]

### Error Handling: Match claude-bridge.js Pattern

`claude-bridge.js` NEVER throws from `query()` — it catches all errors and returns user-friendly **strings** that get spoken to the caller via TTS. The openclaw bridge MUST follow this same pattern:

```js
// Connection refused → friendly message
if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
  return "I'm having trouble connecting to my brain right now. Please try again later.";
}

// Timeout → friendly message
if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
  return "I'm sorry, that request took too long. Please try again.";
}

// HTTP 503 from plugin → unavailability message
if (error.response && error.response.status === 503) {
  return "The agent is currently unavailable. Please try again later.";
}

// Unknown error → generic friendly message
return "I encountered an unexpected error. Please try again.";
```

This is critical — if `query()` throws, `conversation-loop.js` will catch it at the outer try/catch (line 402) and play "Sorry, something went wrong" — losing the conversation turn. By returning a string, the caller gracefully speaks the error to the user.

[Source: voice-app/lib/claude-bridge.js:51-67 — error handling pattern]
[Source: voice-app/lib/conversation-loop.js:402 — outer catch]

### HTTP Client: Use axios (Already a Dependency)

`claude-bridge.js` uses `axios`. The voice-app `package.json` already includes it as a dependency. Use axios in `openclaw-bridge.js` for consistency — do NOT introduce `node-fetch` or native `fetch()`.

**axios patterns from claude-bridge.js to replicate:**
```js
const axios = require('axios');

// POST with timeout and auth
const response = await axios.post(
  `${OPENCLAW_WEBHOOK_URL}/voice/query`,
  { prompt, callId, accountId, peerId },
  {
    timeout: timeout * 1000,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENCLAW_API_KEY}`
    }
  }
);

// GET for health check
await axios.get(`${OPENCLAW_WEBHOOK_URL}/voice/health`, {
  timeout: 5000,
  headers: { 'Authorization': `Bearer ${OPENCLAW_API_KEY}` }
});
```

[Source: voice-app/lib/claude-bridge.js:7 — axios import]
[Source: voice-app/package.json — axios dependency]

### Timeout Strategy

`claude-bridge.js` uses a default 30s timeout for queries and 5s for endSession/health. The openclaw bridge should use the same defaults:
- `query()`: `timeout` from options, default 30s
- `endSession()`: 5s fixed
- `isAvailable()`: 5s fixed

[Source: voice-app/lib/claude-bridge.js:20 — `timeout = 30`]
[Source: voice-app/lib/claude-bridge.js:85 — endSession 5000ms]
[Source: voice-app/lib/claude-bridge.js:101 — isAvailable 5000ms]

### Environment Variable Validation

The bridge should validate required env vars at load time:
- `OPENCLAW_WEBHOOK_URL` — REQUIRED when `BRIDGE_TYPE=openclaw`. Log a clear warning if missing (don't throw — let `isAvailable()` return false).
- `OPENCLAW_API_KEY` — REQUIRED. Log warning if missing.

Do NOT throw on missing env vars — the voice-app may be starting up before the plugin is ready. Let `isAvailable()` handle readiness checking.

[Source: architecture.md#Error Handling Pattern — graceful degradation]

### .env.example Updates

Add a new section between "Claude API Server" and "ElevenLabs TTS":

```bash
# ====================================
# Bridge Selection
# ====================================
# Which AI backend to use: "claude" (default) or "openclaw"
BRIDGE_TYPE=claude

# ====================================
# OpenClaw Plugin (when BRIDGE_TYPE=openclaw)
# ====================================
# URL to OpenClaw SIP voice plugin webhook server
OPENCLAW_WEBHOOK_URL=http://openclaw-server:3334

# API key for webhook authentication (must match plugin config)
OPENCLAW_API_KEY=your-openclaw-api-key
```

[Source: .env.example — current file structure]

### Testing Pattern from Stories 1.1–1.3

All voice-app and plugin tests use `node:test` + `node:assert`. For the bridge tests:

1. **HTTP mocking**: Create a real Express server on port 0 (OS-assigned). Do NOT mock axios internals — that couples tests to implementation.
2. **Module cache clearing**: `delete require.cache[require.resolve('../lib/openclaw-bridge')]` between tests to reset env var reads.
3. **Env var isolation**: Set `process.env.OPENCLAW_WEBHOOK_URL` and `process.env.OPENCLAW_API_KEY` before requiring the module.

```js
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

// Create test server
const app = express();
app.use(express.json());
let testPort;
let server;

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  testPort = server.address().port;
  process.env.OPENCLAW_WEBHOOK_URL = `http://127.0.0.1:${testPort}`;
  process.env.OPENCLAW_API_KEY = 'test-key';
});
```

Test file location: `voice-app/test/openclaw-bridge.test.js`

[Source: openclaw-plugin/test/webhook.test.js — HTTP test server pattern]
[Source: openclaw-plugin/test/index.test.js — module cache clearing pattern]

### Forward Compatibility: Story 2.1 (accountId)

Story 2.1 will add `accountId` to each device in `devices.json` and modify callers (`sip-handler.js`, `conversation-loop.js`) to pass `deviceConfig.accountId` and caller phone number as `peerId` in the options object to `query()`. For now, the bridge must handle `accountId` and `peerId` being `undefined`:

```js
// Omit undefined fields from POST body
const body = { prompt, callId };
if (accountId) body.accountId = accountId;
if (peerId) body.peerId = peerId;
```

This ensures the bridge works both before (Story 1.4) and after (Story 2.1) the caller-side changes.

[Source: epics.md#Story 2.1 — adds accountId to devices.json and callers]

### Previous Story Intelligence (1.3)

Key learnings from Story 1.3 that apply to this story:
- **`req.body || {}` guards**: Always guard against undefined body in error handlers
- **queryAgent callback pattern**: Story 1.3 used dependency inversion (callback) — the bridge uses the same principle (HTTP abstraction)
- **Testing**: 22 new tests in Story 1.3 used real Express test servers on port 0 — follow this pattern
- **Code review fixes**: H1 (req.body crash), H3 (startup validation), M4 (body size limit) — apply similar rigor
- **PII discipline**: `peerId` at DEBUG only — the bridge should log `callId` and `accountId` at INFO, never `peerId`

[Source: 1-3-voice-query-routing.md#Completion Notes List]
[Source: 1-3-voice-query-routing.md#Senior Developer Review]

### Files Created/Modified

```
voice-app/
├── lib/
│   └── openclaw-bridge.js    ← NEW (only new file in voice-app)
├── index.js                   ← MODIFIED (bridge loader: ~4 lines changed at line 19)
└── test/
    └── openclaw-bridge.test.js ← NEW (bridge unit tests)

.env.example                   ← MODIFIED (add BRIDGE_TYPE, OPENCLAW_* vars)
```

No plugin changes. No other voice-app lib files changed.

[Source: architecture.md#Complete Project Directory Structure]
[Source: CLAUDE.md#Directory Structure]

### Project Structure Notes

- Alignment with unified project structure: `openclaw-bridge.js` placed alongside `claude-bridge.js` in `voice-app/lib/` — consistent with bridge pattern
- `voice-app/test/` directory may need to be created (currently only has `freeswitch-retry.test.js`)
- No conflicts detected with existing files or patterns

### References

- [Source: epics.md#Story 1.4] — Acceptance criteria and user story statement
- [Source: architecture.md#Bridge Interface Contract (MANDATORY)] — Drop-in interface specification
- [Source: architecture.md#HTTP Contract (MANDATORY)] — Exact endpoint specifications and JSON shapes
- [Source: architecture.md#Session Key Format] — callId = UUID v4, never transform
- [Source: architecture.md#Error Handling Pattern] — Graceful degradation, no crash on errors
- [Source: architecture.md#Module System Rules] — CommonJS only
- [Source: architecture.md#Logging Rules] — PII at DEBUG only
- [Source: voice-app/lib/claude-bridge.js] — ACTUAL bridge interface to match (query, endSession, isAvailable)
- [Source: voice-app/index.js:19] — Current hardcoded bridge require to replace
- [Source: voice-app/lib/sip-handler.js:222-224] — Bridge query() call site (actual signature)
- [Source: voice-app/lib/conversation-loop.js:359-362] — Bridge query() call site (actual signature)
- [Source: voice-app/lib/conversation-loop.js:382] — extractVoiceLine expects string from bridge
- [Source: voice-app/lib/conversation-loop.js:436] — endSession(callUuid) call site
- [Source: .env.example] — Current env var documentation structure
- [Source: prd.md#FR27] — Env var bridge configuration
- [Source: prd.md#NFR-I2] — Drop-in bridge compatibility
- [Source: prd.md#NFR-I3] — All operations non-blocking
- [Source: prd.md#NFR-S3] — Caller phone numbers at DEBUG only
- [Source: 1-3-voice-query-routing.md] — Previous story learnings and code review fixes

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation matched story spec exactly; no debugging required.

### Completion Notes List

- Created `voice-app/lib/openclaw-bridge.js`: drop-in replacement for `claude-bridge.js` with identical `query(prompt, options)`, `endSession(callId)`, `isAvailable()` interface. Uses axios, CommonJS, all async. Omits `accountId`/`peerId` from POST body when undefined (forward compat with Story 2.1). Error handling matches claude-bridge.js pattern — `query()` returns friendly strings on ECONNREFUSED, ETIMEDOUT, 503; never throws.
- Created `voice-app/lib/bridge-loader.js`: thin helper that reads `BRIDGE_TYPE`, validates it, logs `[BRIDGE] Using <type> bridge`, and returns the required bridge module. Extracted from index.js for testability.
- Modified `voice-app/index.js` line 19: replaced hardcoded `require("./lib/claude-bridge")` with `require('./lib/bridge-loader').loadBridge()`. Variable name `claudeBridge` preserved unchanged throughout the file.
- Updated `.env.example`: added "Bridge Selection" and "OpenClaw Plugin" sections between Claude API Server and ElevenLabs TTS sections.
- Added 17 bridge tests in `voice-app/test/openclaw-bridge.test.js` (real Express server on port 0, node:test, no axios mocks).
- Added 4 bridge loader tests in `voice-app/test/bridge-loader.test.js` (module identity verification via require cache).
- All 22 voice-app tests pass (21 new + 1 existing freeswitch-retry). All 74 plugin tests pass. 0 lint errors.
- PII discipline maintained: `peerId` not logged at INFO level; callId and accountId logged at INFO.

### File List

voice-app/lib/openclaw-bridge.js (NEW)
voice-app/lib/bridge-loader.js (NEW)
voice-app/index.js (MODIFIED)
voice-app/test/openclaw-bridge.test.js (NEW)
voice-app/test/bridge-loader.test.js (NEW)
.env.example (MODIFIED)

## Change Log

- 2026-02-24: Story 1.4 implemented — OpenClaw bridge and bridge loader. New `openclaw-bridge.js` provides drop-in replacement for `claude-bridge.js` routing calls through OpenClaw plugin HTTP API. New `bridge-loader.js` enables `BRIDGE_TYPE` env var selection. `index.js` updated to use bridge loader. `.env.example` updated with bridge configuration vars. 21 new tests added.

# Story 1.1: Plugin Scaffold & Channel Registration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want to install the OpenClaw SIP voice plugin and have it register as a channel,
so that OpenClaw recognizes SIP voice as an available communication channel.

## Acceptance Criteria

1. **Given** the `openclaw-plugin/` directory contains a valid `openclaw.plugin.json` manifest with fields `id`, `version`, `name`, `description`, `main`, `configSchema`
   **When** the operator runs `openclaw plugins install -l ./openclaw-plugin`
   **Then** OpenClaw loads the plugin without errors and the SIP voice channel appears in the registered channels list

2. **Given** the plugin entry point (`src/index.js`) calls `api.registerChannel()` on initialization
   **When** the OpenClaw gateway starts
   **Then** the plugin registers the SIP voice channel and logs `[sip-voice] channel registered` at INFO level

3. **Given** the plugin uses CommonJS (`require`/`module.exports`) and contains no synchronous I/O
   **When** the plugin loads inside the OpenClaw gateway event loop
   **Then** no blocking operations occur and all other channels continue functioning normally

4. **Given** the plugin includes `src/logger.js`
   **When** any plugin component logs a message
   **Then** the log line is prefixed with `[sip-voice]`

## Tasks / Subtasks

- [x] Task 1: Create `openclaw-plugin/openclaw.plugin.json` plugin manifest (AC: #1)
  - [x] Include all required fields: `id`, `version`, `name`, `description`, `main`, `configSchema`
  - [x] Set `"main": "src/index.js"`
  - [x] Define `configSchema` covering `webhookPort`, `apiKey`, `accounts`, `bindings`, `identityLinks`, `dmPolicy`

- [x] Task 2: Create `openclaw-plugin/package.json` (AC: #3)
  - [x] Set `"name": "openclaw-sip-voice"`, `"version": "1.0.0"`
  - [x] CommonJS: do NOT set `"type": "module"`
  - [x] Add `"express": "^4"` as dependency (needed by Story 1.2 webhook server)
  - [x] No native dependencies — only pure JS packages (no node-gyp)

- [x] Task 3: Create `openclaw-plugin/src/logger.js` (AC: #4)
  - [x] Implement `info`, `warn`, `error`, `debug` methods
  - [x] All output prefixed with `[sip-voice]` enforced in `formatMessage` (not per-callsite)
  - [x] `debug` gated by `process.env.DEBUG`
  - [x] Export via `module.exports = { info, warn, error, debug }` (CommonJS)

- [x] Task 4: Create `openclaw-plugin/src/index.js` entry point (AC: #2, #3)
  - [x] Export async `activate(api)` function (called by OpenClaw gateway on load)
  - [x] Call `api.registerChannel({ id: 'sip-voice', name: 'SIP Voice', description: '...' })`
  - [x] Load `accounts` and `bindings` from `api.getConfig()` into module-level store (see Implementation Note)
  - [x] Export `getConfig()` accessor for use by future webhook handlers
  - [x] Log `[sip-voice] channel registered` at INFO after successful registration (with account/binding counts)
  - [x] CommonJS only — no `import`/`export` syntax anywhere
  - [x] No `fs.readFileSync` or other synchronous I/O

## Dev Notes

### CRITICAL: Config Loader Required in This Story

Per the implementation readiness assessment: Story 1.3 (Voice Query Routing) depends on `accountId` → `agentId` binding resolution. The full multi-binding config is fleshed out in Story 2.2. For Epic 1 to be self-contained and Story 1.3 to be implementable without waiting for Story 2.2, `src/index.js` **must** initialize a config loader in this story — even if only a single binding entry is configured.

Suggested implementation for `src/index.js`:

```js
'use strict';

const logger = require('./logger');

let pluginConfig = {};

async function activate(api) {
  pluginConfig = api.getConfig() || {};

  api.registerChannel({
    id: 'sip-voice',
    name: 'SIP Voice',
    description: 'SIP telephone channel for OpenClaw agents'
  });

  const accounts = pluginConfig.accounts || [];
  const bindings = pluginConfig.bindings || [];
  logger.info('channel registered', {
    accounts: accounts.length,
    bindings: bindings.length
  });
}

function getConfig() {
  return pluginConfig;
}

module.exports = { activate, getConfig };
```

[Source: implementation-readiness-report-2026-02-22.md#Recommended Next Steps]
[Source: epics.md#Story 1.1]

### OpenClaw Plugin API Contract

**CRITICAL CORRECTION**: The plugin API is `api.registerChannel()` + `api.registerGatewayMethod()` — **NOT** `gateway.start()` / `gateway.on()` as the original PRD assumed. Architecture has corrected this.

The entry point function is `activate(api)` where `api` provides:
- `api.registerChannel(channelDef)` — registers SIP voice as an OpenClaw channel
- `api.registerGatewayMethod(name, fn)` — registers callable gateway methods (used in Story 5.1 for outbound)
- `api.getConfig()` — returns the plugin's config section from OpenClaw config YAML (synchronous getter — safe to call without await)

Reference pattern from OpenClaw's `extensions/voice-call` source:
```js
async function activate(api) {
  // setup...
  api.registerChannel({ id: 'sip-voice', name: 'SIP Voice' });
}
module.exports = { activate };
```

[Source: architecture.md#Technical Constraints & Dependencies]
[Source: epics.md#Additional Requirements]

### Plugin Manifest (`openclaw.plugin.json`) — All Required Fields

All 6 top-level fields are required by the OpenClaw plugin loader:

```json
{
  "id": "openclaw-sip-voice",
  "version": "1.0.0",
  "name": "SIP Voice Channel",
  "description": "SIP telephone channel for OpenClaw agents via FreePBX",
  "main": "src/index.js",
  "configSchema": {
    "webhookPort": { "type": "number", "default": 3334 },
    "apiKey": { "type": "string" },
    "dmPolicy": { "type": "string", "default": "allowlist" },
    "accounts": { "type": "array", "items": { "type": "object" } },
    "bindings": { "type": "array", "items": { "type": "object" } },
    "identityLinks": { "type": "object" }
  }
}
```

[Source: architecture.md#Gap Analysis]

### Logger Pattern — Model on voice-app/lib/logger.js

The `[sip-voice]` prefix is mandatory on all plugin log lines and must be enforced inside `logger.js` — not added manually at each call site.

```js
// openclaw-plugin/src/logger.js
'use strict';

function formatMessage(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const dataStr = Object.keys(data).length > 0 ? ' ' + JSON.stringify(data) : '';
  return `[${timestamp}] ${level.toUpperCase()} [sip-voice] ${message}${dataStr}`;
}

function info(message, data)  { console.log(formatMessage('info', message, data)); }
function warn(message, data)  { console.warn(formatMessage('warn', message, data)); }
function error(message, data) { console.error(formatMessage('error', message, data)); }
function debug(message, data) {
  if (process.env.DEBUG) {
    console.log(formatMessage('debug', message, data));
  }
}

module.exports = { info, warn, error, debug };
```

Note: `voice-app/lib/logger.js` does NOT prefix with `[sip-voice]` — that prefix is plugin-only.

[Source: voice-app/lib/logger.js — pattern reference]
[Source: architecture.md#Logging Rules]

### Module System — CommonJS Only

Both `voice-app` and `openclaw-plugin` MUST use CommonJS. ESM breaks the drachtio ecosystem.

```js
// CORRECT
const logger = require('./logger');
module.exports = { activate, getConfig };

// WRONG — breaks drachtio ecosystem
import logger from './logger.js';
export default { activate, getConfig };
```

[Source: architecture.md#Module System Rules]
[Source: epics.md#Additional Requirements]

### Async Discipline — No Blocking I/O

All plugin code runs inside the OpenClaw gateway event loop. One blocking operation stalls ALL agents.

```js
// CORRECT — config via synchronous getter provided by the gateway API
const config = api.getConfig();

// CORRECT — if file I/O ever needed in future stories
const data = await fs.promises.readFile('file.json', 'utf8');

// WRONG — blocks all agents on the gateway
const data = fs.readFileSync('file.json', 'utf8'); // NEVER
```

In this story, no file I/O is needed — all config comes from `api.getConfig()`.

[Source: architecture.md#Async Rules]

### No Native Dependencies

`openclaw-plugin/package.json` must not include packages requiring native compilation (no `node-gyp`, no C++ addons). Express is pure JS and is acceptable.

[Source: architecture.md#Technical Constraints, NFR-I4]

### PII / Security Rules (Applied From First Story)

Even though Story 1.1 has no caller data yet, establish the discipline:
- `logger.info(...)` — never include phone numbers
- `logger.debug(...)` — phone numbers (`peerId`) ONLY here
- API key from `api.getConfig().apiKey` — never log at any level

[Source: architecture.md#Logging Rules, NFR-S2, NFR-S3]

### Project Structure Notes

**Files created in this story only** (no voice-app changes in Story 1.1):

```
openclaw-plugin/
├── openclaw.plugin.json   ← NEW (plugin manifest)
├── package.json           ← NEW (npm package, express dep)
└── src/
    ├── index.js           ← NEW (api.registerChannel() + config loader)
    └── logger.js          ← NEW ([sip-voice] prefixed logger)
```

No changes to `voice-app/` in Story 1.1. The bridge and bridge loader are Story 1.4.

Future Epic 1 stories add:
- Story 1.2: `openclaw-plugin/src/webhook-server.js`, `src/session-store.js`, `src/auth.js`
- Story 1.4: `voice-app/lib/openclaw-bridge.js` + bridge loader in `voice-app/index.js`

[Source: architecture.md#Complete Project Directory Structure]

### Forward Note for Story 1.4 — Bridge Signature Discrepancy

**For awareness only — does not affect Story 1.1:**

The architecture spec (`architecture.md#Bridge Interface Contract`) defines:
```js
async query(prompt, callId, deviceConfig)  // 3-argument signature
```

But the existing `conversation-loop.js` (line 359) actually calls:
```js
claudeBridge.query(transcript, { callId: callUuid, devicePrompt: devicePrompt })
// (2-argument: prompt, options object)
```

Story 1.4 dev agent must reconcile this before marking complete. Two valid approaches:
1. Make `openclaw-bridge.js` accept `query(prompt, options)` matching existing callers, then update `conversation-loop.js` to add `accountId` and `peerId` to the options object
2. Update `conversation-loop.js` in Story 1.4 to use the 3-arg architecture-spec signature, passing full device config

Either approach is valid — the key constraint is that `openclaw-bridge.js` must be a drop-in that works with `conversation-loop.js`.

[Source: voice-app/lib/conversation-loop.js:359-362]
[Source: voice-app/lib/claude-bridge.js:19]
[Source: architecture.md#Bridge Interface Contract]

### References

- [Source: epics.md#Story 1.1] — Acceptance criteria and user story statement
- [Source: architecture.md#Core Architectural Decisions] — Plugin API: `api.registerChannel()`
- [Source: architecture.md#Module System Rules] — CommonJS requirement
- [Source: architecture.md#Async Rules] — No synchronous I/O
- [Source: architecture.md#Logging Rules] — `[sip-voice]` prefix, PII discipline
- [Source: architecture.md#Gap Analysis] — Plugin manifest required fields
- [Source: architecture.md#Complete Project Directory Structure] — Files to create
- [Source: implementation-readiness-report-2026-02-22.md#Recommended Next Steps] — Config loader note for Story 1.3 compatibility
- [Source: voice-app/lib/logger.js] — Logger pattern reference
- [Source: voice-app/lib/claude-bridge.js] — Bridge interface reference
- [Source: voice-app/lib/conversation-loop.js:359-362] — Actual bridge call signature in use

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation was clean on first pass.

### Completion Notes List

- All 4 tasks implemented following red-green-refactor cycle: 23 tests written first (all failing), then implementation created, all 23 pass.
- `openclaw.plugin.json`: All 6 required fields present; configSchema covers all 6 config keys; webhookPort defaults to 3334.
- `package.json`: CommonJS (no `type: module`), express ^4 dependency, no native deps.
- `src/logger.js`: `[sip-voice]` prefix enforced inside `formatMessage()` — not at callsites; debug gated by `process.env.DEBUG`; uses console.log/warn/error appropriately.
- `src/index.js`: async `activate(api)` calls `api.getConfig()` then `api.registerChannel()`; module-level `pluginConfig` store initialized; `getConfig()` accessor exported for future webhook handlers; logs account/binding counts at INFO level; pure CommonJS, no sync I/O.
- ESLint config updated to include `openclaw-plugin/**/*.js` (CommonJS rules).
- Root `package.json` updated to include `test:plugin` in test suite.
- No voice-app regressions — all existing tests pass.

### Senior Developer Review (AI)

**Review Date:** 2026-02-23
**Outcome:** Changes Requested — all fixed in same session

**Action Items:**

- [x] [High] Missing test: `activate()` log output not verified — AC #2 log requirement untested; added 2 new index tests capturing console.log during activate()
- [x] [Medium] `eslint.config.js` missing `openclaw-plugin/node_modules/**` in ignores — would lint express source tree on npm install
- [x] [Medium] `getConfig()` returns live mutable reference to internal pluginConfig — changed to return shallow copy `{ ...pluginConfig }`
- [x] [Medium] `activate()` no error logging before rethrowing if `registerChannel` throws — added try/catch with `logger.error(...)` + rethrow; added test
- [x] [Low] `dmPolicy` default value `"allowlist"` not enforced by any test — added manifest test
- [x] [Low] `formatMessage` data param uses null guard instead of documented default parameter `data = {}` — fixed to use default parameter
- [x] [Low] Plugin `package.json` missing `"private": true` — added; added manifest test

### File List

- `openclaw-plugin/openclaw.plugin.json` (new)
- `openclaw-plugin/package.json` (new — modified in review: added `"private": true`)
- `openclaw-plugin/src/index.js` (new — modified in review: try/catch in activate, shallow copy in getConfig)
- `openclaw-plugin/src/logger.js` (new — modified in review: default parameter `data = {}`)
- `openclaw-plugin/test/index.test.js` (new — modified in review: added 4 tests for H1/M2/M3)
- `openclaw-plugin/test/logger.test.js` (new)
- `openclaw-plugin/test/manifest.test.js` (new — modified in review: added 2 tests for L1/L3)
- `eslint.config.js` (modified — added openclaw-plugin to CommonJS rule + node_modules ignore)
- `package.json` (modified — added test:plugin script)

### Change Log

- 2026-02-23: Implemented Story 1.1 — Plugin scaffold and channel registration. Created openclaw-plugin directory with manifest, package.json, logger, and entry point. 23 unit tests added covering all ACs.
- 2026-02-23: Code review — fixed 7 findings (1 High, 3 Medium, 3 Low). 29 tests now pass. Story marked done.

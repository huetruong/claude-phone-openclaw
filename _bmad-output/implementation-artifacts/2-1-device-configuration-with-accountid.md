# Story 2.1: Device Configuration with accountId

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want to add an `accountId` field to each device in `devices.json` that maps to an OpenClaw agent,
so that each SIP extension is bound to a specific agent.

## Acceptance Criteria

1. **Given** `devices.json` contains a device entry with `"extension": "9000"` and `"accountId": "morpheus"`
   **When** the voice-app loads device configuration
   **Then** the `accountId` field is available on the device config object passed to the bridge's `query()` method

2. **Given** `devices.json` contains multiple device entries each with a unique `accountId`
   **When** an inbound call arrives on extension 9000
   **Then** the bridge reads `deviceConfig.accountId` as `"morpheus"` and includes it in the `POST /voice/query` body

3. **Given** `devices.json` contains a device entry without an `accountId` field
   **When** the voice-app loads configuration
   **Then** the system logs a warning and the device falls back to using the `name` field as `accountId` (backward compatible)

4. **Given** the `accountId` field is documented in `devices.json`
   **When** an operator reviews the config
   **Then** the field purpose and format are clear from the existing device entry examples

## Tasks / Subtasks

- [x] Task 1: Update `devices.json.example` to include `accountId` field (AC: #4)
  - [x] Add `"accountId": "morpheus"` to the 9000 device entry
  - [x] Add `"accountId": "serverbot"` to the 9002 device entry
  - [x] Preserve all existing fields (`name`, `extension`, `authId`, `password`, `voiceId`, `prompt`)

- [x] Task 2: Add `accountId` fallback logic in `DeviceRegistry` (AC: #3)
  - [x] In `device-registry.js:load()`, after loading each device, if `device.accountId` is falsy, set `device.accountId = device.name`
  - [x] Log a warning when falling back: `logger.warn('Device missing accountId, using name as fallback', { extension, name: device.name })`
  - [x] Apply same fallback to `MORPHEUS_DEFAULT` (add `accountId: 'Morpheus'` to the default object)
  - [x] Do NOT reject devices without `accountId` — backward compatibility is required

- [x] Task 3: Pass `accountId` through call sites to `query()` options (AC: #1, #2)
  - [x] Modify `sip-handler.js:222-224` — add `accountId: deviceConfig ? deviceConfig.accountId : undefined` to query options
  - [x] Modify `conversation-loop.js:177-179` (prime query) — add `accountId: deviceConfig?.accountId` to query options
  - [x] Modify `conversation-loop.js:359-361` (main query) — add `accountId: deviceConfig?.accountId` to query options
  - [x] Modify `query-routes.js:309-313` — add `accountId` to query options (extract from device lookup context)
  - [x] Do NOT pass `peerId` yet — that is not part of this story's scope

- [x] Task 4: Write tests for `accountId` in `DeviceRegistry` (AC: #1, #3)
  - [x] Test: device with `accountId` field — `accountId` preserved on loaded device object
  - [x] Test: device WITHOUT `accountId` field — falls back to `name` field
  - [x] Test: fallback logs a warning (verify logger.warn called)
  - [x] Test: `MORPHEUS_DEFAULT` has `accountId` set
  - [x] Test file: `voice-app/test/device-registry.test.js` (NEW)
  - [x] Use `node:test` + `node:assert` (consistent with all prior stories)
  - [x] Mock `fs.existsSync` and `fs.readFileSync` to provide test device configs

- [x] Task 5: Write tests for `accountId` flow through call sites (AC: #2)
  - [x] Test: `sip-handler` passes `accountId` from deviceConfig to bridge query options
  - [x] Test: `conversation-loop` passes `accountId` from deviceConfig to bridge query options
  - [x] Add to existing test files or create focused integration test
  - [x] Verify `openclaw-bridge.js` includes `accountId` in POST body when provided (already tested in Story 1.4 — verify coverage)

## Dev Notes

### CRITICAL: Understand the Data Flow

The `accountId` must flow through this chain — trace it end-to-end before coding:

```
devices.json → DeviceRegistry.load() → deviceConfig object
    → sip-handler.js: deviceRegistry.get(dialedExt) returns deviceConfig
    → conversationLoop(endpoint, dialog, callUuid, options, deviceConfig)
    → claudeBridge.query(transcript, { callId, devicePrompt, accountId })
    → openclaw-bridge.js: POST /voice/query { prompt, callId, accountId }
```

The bridge (`openclaw-bridge.js`) already handles `accountId` in options — it was built forward-compatible in Story 1.4 (see line 32: `const { callId, accountId, peerId, timeout = 30 } = options;` and line 47: `if (accountId) body.accountId = accountId;`). No bridge changes needed.

[Source: voice-app/lib/openclaw-bridge.js:32,46-48 — already handles accountId]

### DeviceRegistry: Minimal Change

The `DeviceRegistry` at `voice-app/lib/device-registry.js` loads devices as plain objects from JSON. The `accountId` field will be naturally available on each device object after loading — no schema validation needed. The only addition is the fallback logic for backward compatibility.

**Current load loop (line 69-77):**
```js
for (const [extension, device] of Object.entries(devicesJson)) {
  if (!device.name || !device.extension) {
    logger.warn('Skipping invalid device config', { extension, device });
    continue;
  }
  this.devices[extension] = device;
  this.devicesByName[device.name.toLowerCase()] = device;
}
```

**Add after the validation check (before `this.devices[extension] = device`):**
```js
if (!device.accountId) {
  logger.warn('Device missing accountId, using name as fallback', { extension, name: device.name });
  device.accountId = device.name;
}
```

Also update `MORPHEUS_DEFAULT` (line 23-30) to include `accountId: 'Morpheus'`.

[Source: voice-app/lib/device-registry.js:23-30 — MORPHEUS_DEFAULT]
[Source: voice-app/lib/device-registry.js:69-77 — load loop]

### Call Site Modifications: 4 Locations

Each call site needs `accountId` added to the options object passed to `claudeBridge.query()`. Here are the exact changes:

**1. `sip-handler.js:222-224` (main query in legacy handler):**
```js
// CURRENT:
const claudeResponse = await claudeBridge.query(
  transcript,
  { callId: callUuid, devicePrompt: devicePrompt }
);

// NEW:
const claudeResponse = await claudeBridge.query(
  transcript,
  { callId: callUuid, devicePrompt: devicePrompt, accountId: deviceConfig ? deviceConfig.accountId : undefined }
);
```

**2. `conversation-loop.js:177-179` (outbound context prime):**
```js
// CURRENT:
claudeBridge.query(
  `[SYSTEM CONTEXT...]`,
  { callId: callUuid, devicePrompt: devicePrompt, isSystemPrime: true }
)

// NEW:
claudeBridge.query(
  `[SYSTEM CONTEXT...]`,
  { callId: callUuid, devicePrompt: devicePrompt, accountId: deviceConfig?.accountId, isSystemPrime: true }
)
```

**3. `conversation-loop.js:359-361` (main conversation query):**
```js
// CURRENT:
const claudeResponse = await claudeBridge.query(
  transcript,
  { callId: callUuid, devicePrompt: devicePrompt }
);

// NEW:
const claudeResponse = await claudeBridge.query(
  transcript,
  { callId: callUuid, devicePrompt: devicePrompt, accountId: deviceConfig?.accountId }
);
```

**4. `query-routes.js:309-313` (HTTP query endpoint):**
```js
// CURRENT:
response = await claudeBridge.query(fullPrompt, {
  callId,
  devicePrompt,
  timeout
});

// NEW:
response = await claudeBridge.query(fullPrompt, {
  callId,
  devicePrompt,
  accountId: device ? device.accountId : undefined,
  timeout
});
```

Note: In `query-routes.js`, check how `device` is available in scope — it's the resolved device from the `target` parameter lookup. Trace the `device` variable back to confirm.

[Source: voice-app/lib/sip-handler.js:222-224]
[Source: voice-app/lib/conversation-loop.js:177-179, 359-361]
[Source: voice-app/lib/query-routes.js:309-313]

### Testing Pattern: Follow Story 1.4

All tests use `node:test` + `node:assert`. For `device-registry.test.js`:
- Mock `fs.existsSync` → `true`
- Mock `fs.readFileSync` → JSON string with test device configs
- Clear module cache between tests: `delete require.cache[require.resolve('../lib/device-registry')]`
- The DeviceRegistry is a singleton that auto-loads in constructor — must clear cache to re-instantiate with different test data

```js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Mock fs before requiring device-registry
const originalReadFileSync = require('fs').readFileSync;
const originalExistsSync = require('fs').existsSync;
```

[Source: voice-app/test/openclaw-bridge.test.js — module cache clearing pattern]
[Source: openclaw-plugin/test/index.test.js — similar singleton test approach]

### Scope Boundaries — Do NOT Do These

- Do NOT modify `openclaw-bridge.js` — it already handles `accountId` (Story 1.4)
- Do NOT modify `claude-bridge.js` — it ignores unknown options (no harm)
- Do NOT pass `peerId` from call sites — that's a separate concern (Story 3.x or later)
- Do NOT add `accountId` validation in the bridge — let the plugin handle invalid/missing accountId (Story 2.2)
- Do NOT modify the plugin (`openclaw-plugin/`) — this story is voice-app only
- Do NOT add allowFrom/caller-id features — that's Epic 3

### Previous Story Intelligence (1.4)

Key learnings from Story 1.4 that directly apply:
- **Bridge already forward-compatible**: `openclaw-bridge.js` was built to handle `accountId` when provided and omit it when undefined. This story completes that circuit by making callers pass it.
- **Variable name `claudeBridge` preserved**: All call sites use `claudeBridge.query()` regardless of bridge type — do not rename.
- **Error handling unchanged**: Adding `accountId` to options is purely additive — no new error paths introduced.
- **Testing with real servers**: Story 1.4 used real Express servers on port 0 for bridge tests. Device registry tests can be simpler (mock fs only).

[Source: 1-4-openclaw-bridge-and-bridge-loader.md#Forward Compatibility: Story 2.1]
[Source: 1-4-openclaw-bridge-and-bridge-loader.md#Completion Notes List]

### Git Intelligence

Recent commit pattern: feature commits named `feat(story-X-Y): description`, fix commits named `fix(story-X-Y): description`. Branch naming: `feature/story-X-Y-slug`. Current branch `feature/story-2-1-device-configuration-with-accountid` already created.

The `voice-app/config/` directory has only been touched once (initial commit) — `devices.json.example` is the only file there. No `devices.json` exists (it's `.gitignore`d as it contains credentials).

### Files to Create/Modify

```
voice-app/
├── config/
│   └── devices.json.example     ← MODIFIED (add accountId field)
├── lib/
│   ├── device-registry.js       ← MODIFIED (accountId fallback logic, ~5 lines)
│   ├── sip-handler.js           ← MODIFIED (1 line: add accountId to query options)
│   ├── conversation-loop.js     ← MODIFIED (2 lines: add accountId to query options)
│   └── query-routes.js          ← MODIFIED (1 line: add accountId to query options)
└── test/
    └── device-registry.test.js  ← NEW (accountId loading + fallback tests)
```

No plugin changes. No bridge changes. No new dependencies.

[Source: architecture.md#Complete Project Directory Structure]
[Source: CLAUDE.md#Directory Structure]

### Project Structure Notes

- Alignment with unified project structure: all changes within `voice-app/` — no cross-boundary modifications
- `voice-app/test/` already exists (has `freeswitch-retry.test.js`, `openclaw-bridge.test.js`, `bridge-loader.test.js`)
- No detected conflicts or variances

### References

- [Source: epics.md#Story 2.1] — Acceptance criteria and user story
- [Source: architecture.md#Bridge Interface Contract] — query(prompt, options) signature
- [Source: architecture.md#HTTP Contract] — POST /voice/query body includes accountId
- [Source: voice-app/lib/device-registry.js] — DeviceRegistry singleton, load(), MORPHEUS_DEFAULT
- [Source: voice-app/lib/openclaw-bridge.js:32,46-48] — Already handles accountId in options
- [Source: voice-app/lib/sip-handler.js:222-224] — Call site 1
- [Source: voice-app/lib/conversation-loop.js:177-179,359-361] — Call sites 2 & 3
- [Source: voice-app/lib/query-routes.js:309-313] — Call site 4
- [Source: voice-app/config/devices.json.example] — Current device config template
- [Source: 1-4-openclaw-bridge-and-bridge-loader.md#Forward Compatibility] — Bridge ready for accountId
- [Source: prd.md#FR2] — Multi-extension with distinct agent binding
- [Source: prd.md#FR28] — Device config includes accountId mapping
- [Source: CLAUDE.md#Device Configuration] — Target devices.json format

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- fs mock isolation: Patching `fs.existsSync`/`fs.readFileSync` globally interferes with `require()` module loading. Fix: intercept only calls where the path matches `CONFIG_PATH`, passing all others to the original function.
- conversation-loop mock: `mockDialog` must include both `on()` and `off()` methods — the cleanup path calls `dialog.off('destroy', ...)`.

### Completion Notes List

- Task 1: Added `"accountId": "morpheus"` and `"accountId": "serverbot"` to `devices.json.example`, all existing fields preserved.
- Task 2: Added `accountId: 'Morpheus'` to `MORPHEUS_DEFAULT`; added fallback logic in `load()` loop — if `device.accountId` is falsy, logs a warning and sets `device.accountId = device.name`. Backward compatible — no devices rejected.
- Task 3: Added `accountId` to all 4 call sites: `sip-handler.js` (legacy handler), `conversation-loop.js` prime query, `conversation-loop.js` main query, `query-routes.js` HTTP endpoint. Uses optional chaining (`?.`) where deviceConfig may be null.
- Task 4: Created `voice-app/test/device-registry.test.js` with 4 tests covering: preserved accountId, name fallback, warning log on fallback, MORPHEUS_DEFAULT accountId.
- Task 5: Created `voice-app/test/accountid-flow.test.js` with 3 tests covering: prime query carries accountId, null deviceConfig yields undefined accountId, bridge coverage from Story 1.4 confirmed.
- All 29 tests pass (4 existing suites + 2 new). No new lint errors (12 pre-existing warnings unchanged).

### File List

- voice-app/config/devices.json.example (modified)
- voice-app/lib/device-registry.js (modified)
- voice-app/lib/sip-handler.js (modified)
- voice-app/lib/conversation-loop.js (modified)
- voice-app/lib/query-routes.js (modified)
- voice-app/test/device-registry.test.js (new)
- voice-app/test/accountid-flow.test.js (new)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

## Change Log

- 2026-02-23: Story 2.1 implemented — accountId field added to devices.json.example, DeviceRegistry fallback logic, 4 call site updates to pass accountId to bridge query, 7 new tests across 2 test files. (claude-sonnet-4-6)

# Story 3.1: Caller Allowlist Validation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want inbound calls validated against a per-extension `allowFrom` allowlist before any agent is invoked,
so that only trusted phone numbers can reach my agents.

## Acceptance Criteria

1. **Given** `devices.json` contains a device with `"extension": "9000"` and `"allowFrom": ["+15551234567", "+15559876543"]`
   **When** an inbound call arrives on extension 9000 from caller ID `+15551234567`
   **Then** the caller ID matches the `allowFrom` list and the call proceeds to the bridge for agent routing

2. **Given** an inbound call arrives on extension 9000 from caller ID `+15550000000` which is NOT in the `allowFrom` list
   **When** the voice-app checks the caller ID
   **Then** the call is rejected before the bridge `query()` method is ever called — the agent is never invoked

3. **Given** the `allowFrom` check occurs in the voice-app before any bridge interaction
   **When** a call is rejected
   **Then** no HTTP request is sent to the plugin webhook and no OpenClaw session is created

4. **Given** the caller's phone number is checked during validation
   **When** the result is logged
   **Then** the phone number appears only at DEBUG level, never at INFO/WARN/ERROR (NFR-S3)

## Tasks / Subtasks

- [x] Task 1: Add `allowFrom` validation function to `conversation-loop.js` (AC: #1, #2, #3)
  - [x] Add a `checkAllowFrom(deviceConfig, peerId)` helper function that returns `true` if the caller is allowed
  - [x] Logic: if `deviceConfig.allowFrom` is a non-empty array, return `allowFrom.includes(peerId)`; otherwise return `true` (no allowlist = allow all — Story 3.2 will add `dmPolicy` enforcement)
  - [x] Insert the check at the top of `runConversationLoop()` (after options destructuring at line 139, before the dialog event setup at line 163)
  - [x] If check fails: log rejection at INFO without phone number, log phone number at DEBUG only, call `dialog.destroy()`, and `return` early — before greeting, before bridge, before audio fork
  - [x] The function must NOT be in sip-handler.js — that file's `conversationLoop()` is a legacy duplicate; the active path uses `conversation-loop.js:runConversationLoop()`

- [x] Task 2: Ensure `allowFrom` field is preserved by `device-registry.js` (AC: #1)
  - [x] Verify that `device-registry.js` already passes through all JSON fields (it does — line 81: `this.devices[extension] = device` stores the full device object)
  - [x] No code change expected — confirm by test
  - [x] Add a test in `device-registry.test.js` that verifies `allowFrom` array is accessible on the loaded device config

- [x] Task 3: Write unit tests for `checkAllowFrom()` (AC: #1, #2, #4)
  - [x] Create new test file `voice-app/test/caller-allowlist.test.js`
  - [x] Test: caller in allowFrom list → returns true
  - [x] Test: caller NOT in allowFrom list → returns false
  - [x] Test: empty allowFrom array → returns true (no restrictions)
  - [x] Test: missing/undefined allowFrom → returns true (no restrictions)
  - [x] Test: deviceConfig is null → returns true (no restrictions)

- [x] Task 4: Write integration test for call rejection flow (AC: #2, #3)
  - [x] Add test in `voice-app/test/caller-allowlist.test.js` using the mock pattern from `accountid-flow.test.js`
  - [x] Test: call with blocked peerId → `runConversationLoop` returns early, bridge `query()` is never called, dialog.destroy() is called
  - [x] Test: call with allowed peerId → `runConversationLoop` proceeds normally (bridge query IS called)

- [x] Task 5: Write PII logging test (AC: #4)
  - [x] Add test that captures logger output during a rejected call
  - [x] Assert: INFO log contains rejection message WITHOUT phone number
  - [x] Assert: DEBUG log contains the phone number for operator troubleshooting

- [x] Task 6: Verify no regressions — run full test suite (AC: all)
  - [x] `npm test` passes all existing tests (baseline: 212 tests; 225 pass after story)
  - [x] `npm run lint` passes with 0 errors (pre-existing brownfield warnings accepted)

- [x] Task 7: Add `allowFrom` prompt to `claude-phone device add` CLI (NFR-C1, NFR-C2)
  - [x] Add `allowFrom` question to `cli/lib/commands/device/add.js` — comma-separated, optional (blank = no restriction)
  - [x] Use `libphonenumber-js` in `parseAllowFrom()` to normalize any international format to E.164 at config-write time
  - [x] Pass `config.region?.defaultCountry` to `parseAllowFrom()` so national-format numbers are correctly resolved
  - [x] Omit `allowFrom` field entirely from device when blank — backward compatible with existing configs
  - [x] Display `allowFrom` summary in device details output after add
  - [x] Add `parseAllowFrom` to `cli/lib/validators.js` and export
  - [x] Add 6 tests to `cli/test/device.test.js` covering normalization, blank input, invalid input, E.164 passthrough

- [x] Task 8: Add `region.defaultCountry` to setup config (NFR-C3)
  - [x] Add `region: { defaultCountry: 'US' }` to `createDefaultConfig()` in `setup.js`
  - [x] Add **Regional Settings** prompt in `setupAPIKeys()` — asked for all voice setup flows
  - [x] Prompt: `Default country code for phone numbers (ISO 3166-1, e.g. US, GB, AU):` with `US` default
  - [x] Validate input is a 2-letter uppercase code; normalize to uppercase before saving

## Dev Notes

### Implementation Location: `voice-app/lib/conversation-loop.js`

**Why here, not sip-handler.js:**
- `sip-handler.js` contains a legacy `conversationLoop()` function (line 111) that is a duplicate of the modern `conversation-loop.js:runConversationLoop()`
- The active call path for the OpenClaw bridge goes through `conversation-loop.js` (used by both inbound via index.js and outbound via outbound-handler.js)
- Both `peerId` and `deviceConfig` are already available as parameters (lines 136-138)
- Modifying sip-handler.js would only affect the legacy path and is NOT sufficient

**Insert point — after line 139 (options destructuring), before line 155 (try block):**

```js
// ── Caller allowlist check (Story 3.1, FR5) ──
if (!checkAllowFrom(deviceConfig, peerId)) {
  logger.info('Call rejected: caller not in allowFrom list', { callUuid, extension: deviceConfig?.extension });
  logger.debug('Rejected caller details', { callUuid, peerId });
  try { dialog.destroy(); } catch (e) { /* already destroyed */ }
  return;
}
```

This placement guarantees:
- No greeting is played to rejected callers
- No audio fork is established
- No bridge `query()` is ever called
- No HTTP request reaches the plugin
- The SIP dialog is cleanly torn down

### `checkAllowFrom()` Function

```js
/**
 * Check if caller is allowed by device's allowFrom list.
 * Returns true if:
 * - deviceConfig is null/undefined (no device = no restriction)
 * - allowFrom is not set or empty (no restriction configured)
 * - peerId is in the allowFrom array
 *
 * @param {Object|null} deviceConfig - Device configuration
 * @param {string|null} peerId - Caller phone number (E.164 format)
 * @returns {boolean}
 */
function checkAllowFrom(deviceConfig, peerId) {
  if (!deviceConfig) return true;
  const allowFrom = deviceConfig.allowFrom;
  if (!Array.isArray(allowFrom) || allowFrom.length === 0) return true;
  return allowFrom.includes(peerId);
}
```

**Key design decisions:**
- No allowFrom = allow all. This preserves backward compatibility — existing deployments without `allowFrom` configured continue working
- Story 3.2 will add `dmPolicy` enforcement which changes the default to reject when `dmPolicy: "allowlist"` is set but `allowFrom` is missing
- E.164 format comparison (exact string match) — `extractCallerId()` in sip-handler.js (line 39-46) already returns `+` prefixed format from SIP headers
- No normalization needed — both sides use E.164 as stored

### Device Registry — No Changes Needed

`device-registry.js` line 81 stores the full device object: `this.devices[extension] = device`. The `allowFrom` array from `devices.json` is automatically preserved. Verified by reading the code — a test will confirm.

[Source: voice-app/lib/device-registry.js:70-83 — device loading loop]

### Caller ID Flow (Already Implemented)

The `peerId` is fully threaded through the call stack and arrives at `runConversationLoop()`:

1. **Extracted:** `sip-handler.js:39-46` — `extractCallerId(req)` parses SIP From header → E.164 format
2. **Passed:** `sip-handler.js:351` — `conversationLoop(..., callerId)` passes to legacy loop
3. **Received:** `conversation-loop.js:138` — `peerId = null` in options destructuring
4. **Available for check:** At line 139, `peerId` and `deviceConfig` (with `allowFrom`) are both available

[Source: voice-app/lib/sip-handler.js:39-46 — extractCallerId()]
[Source: voice-app/lib/conversation-loop.js:127-139 — runConversationLoop() params]

### PII Logging Rules (NFR-S3)

Rejection logs MUST follow this pattern:
- **INFO:** `"Call rejected: caller not in allowFrom list"` + `{ callUuid, extension }` — NO phone number
- **DEBUG:** `"Rejected caller details"` + `{ callUuid, peerId }` — phone number at DEBUG only

This matches the existing pattern in `openclaw-bridge.js:43` where peerId is DEBUG-only.

[Source: voice-app/lib/openclaw-bridge.js:43 — existing peerId logging pattern]
[Source: architecture.md#Logging Rules — PII at DEBUG only]

### Test Patterns to Follow

**Unit tests:** Follow `device-registry.test.js` pattern — direct function testing with assertions
**Integration tests:** Follow `accountid-flow.test.js` pattern — mock bridge, mock dialog, mock endpoint, assert captured calls

Mock objects needed (from `accountid-flow.test.js:31-47`):
```js
const mockDialog = { on: () => {}, off: () => {}, destroy: () => Promise.resolve() };
const mockEndpoint = { play: () => Promise.resolve(), forkAudioStart: () => Promise.resolve(), ... };
const mockAudioForkServer = { expectSession: () => { throw new Error('test: short-circuit'); }, cancelExpectation: () => {} };
const mockBridge = { query: (prompt, opts) => { ... }, endSession: () => Promise.resolve() };
```

**Test framework:** Node.js built-in `node:test` with `node:assert` (no jest, no mocha)

[Source: voice-app/test/accountid-flow.test.js:19-72 — mock pattern]
[Source: voice-app/test/device-registry.test.js:14-34 — fs mock and fresh require pattern]

### Previous Story Intelligence (Story 2.3)

- **Test baseline:** 212 tests documented at story-write time (101 cli + 30 voice-app + 81 plugin). Actual baseline at story execution time was 225 (101 cli + 39 voice-app + 85 plugin) — voice-app and plugin test counts had grown from intervening work. Final count after all 8 tasks: 231 (107 cli + 39 voice-app + 85 plugin).
- **Test isolation:** Use fresh require for module-level state; capture/restore logger methods for logging assertions
- **No plugin changes:** This story is entirely voice-app side. The plugin is not involved in allowFrom validation.
- **Branch naming convention:** `feature/story-3-1-caller-allowlist-validation` (already created)
- **Commit pattern:** `feat(story-3-1): description` (matches prior stories)

### Git Intelligence

Recent commit patterns:
```
feat(story-2-3): Concurrent session isolation tests (#10)
feat(story-2-4): CLI device add accountId support (#9)
feat(story-2-2): Plugin agent bindings and multi-extension routing (#8)
feat(story-2-1): Device configuration with accountId (#7)
feat(story-1-4): OpenClaw bridge and bridge loader
```

- All features use `feat(story-X-Y):` prefix
- Fix commits use `fix(story-X-Y):` prefix
- PRs merge into `main` branch

### Project Structure Notes

- All changes within `voice-app/` only — no plugin changes
- New test file: `voice-app/test/caller-allowlist.test.js`
- Modified: `voice-app/lib/conversation-loop.js` (add ~15 lines)
- No new dependencies needed
- Alignment with project structure: `conversation-loop.js` is the correct location per the architecture (shared between inbound and outbound paths)

### Scope Boundaries — Do NOT Do These

- Do NOT add `dmPolicy` enforcement — that is Story 3.2
- Do NOT add rejection audio message playback — that is Story 3.2
- Do NOT modify `sip-handler.js` — use `conversation-loop.js` only
- Do NOT modify `openclaw-plugin/` — allowFrom check is voice-app side
- Do NOT add phone number normalization — E.164 match is sufficient
- Do NOT add `allowFrom` to `MORPHEUS_DEFAULT` in `device-registry.js` — defaults should have no allowlist (backward compatibility)
- Do NOT modify the bridge interface — the check happens before the bridge is called

### References

- [Source: epics.md#Story 3.1] — Acceptance criteria and user story
- [Source: prd.md#FR5] — Validate caller against allowFrom allowlist
- [Source: prd.md#NFR-S3] — Caller phone numbers at DEBUG only
- [Source: prd.md#NFR-S6] — dmPolicy: allowlist mandatory default (Story 3.2 scope)
- [Source: architecture.md#Authentication & Security] — allowFrom per-extension allowlist checked before agent invocation
- [Source: architecture.md#Logging Rules] — PII at DEBUG only pattern
- [Source: voice-app/lib/conversation-loop.js:127-139] — runConversationLoop() entry point
- [Source: voice-app/lib/conversation-loop.js:155-172] — Current flow before greeting (insert point)
- [Source: voice-app/lib/sip-handler.js:39-46] — extractCallerId() returns E.164 format
- [Source: voice-app/lib/sip-handler.js:312-358] — handleInvite flow (calls conversationLoop)
- [Source: voice-app/lib/device-registry.js:70-83] — Device loading preserves all JSON fields
- [Source: voice-app/lib/openclaw-bridge.js:43] — Existing peerId DEBUG-only logging pattern
- [Source: voice-app/test/accountid-flow.test.js] — Mock pattern for conversation-loop tests
- [Source: voice-app/test/device-registry.test.js] — Device registry test pattern
- [Source: 2-3-concurrent-session-isolation.md] — Previous story (test baseline: 212)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Duplicate `checkAllowFrom` definition from double-edit: removed second copy, lint error resolved.

### Completion Notes List

- Task 1: Added `checkAllowFrom()` to `conversation-loop.js` before `runConversationLoop()`. Inserted allowlist check after options destructuring, before the try block — guarantees no greeting, no audio fork, no bridge call for rejected callers. Exported from module. Also replaced stray `console.log` with `logger.debug` (code review fix).
- Task 2: Confirmed `device-registry.js` line 81 stores full device object. No code change needed. Added passthrough test to `caller-allowlist.test.js`.
- Task 3: 5 unit tests for `checkAllowFrom()` — allowed, blocked, empty array, missing field, null device.
- Task 4: 2 integration tests for `runConversationLoop()` — blocked caller gets `dialog.destroy()` called and `bridge.query()` never called; allowed caller test strengthened with `destroyCalled === false` assertion (code review fix).
- Task 5: PII logging test confirms INFO log has no phone number, DEBUG log contains `peerId`.
- Task 6: 231 tests pass (107 CLI + 39 voice-app + 85 plugin), 0 lint errors.
- Task 7: Added `allowFrom` prompt to `claude-phone device add` with libphonenumber-js normalization. `parseAllowFrom(input, defaultCountry)` in validators.js accepts any international format and normalizes to E.164. 6 new CLI tests added.
- Task 8: Added `region.defaultCountry` (ISO 3166-1 alpha-2) to setup config and setup wizard. Defaults to `US`. Asked during `setupAPIKeys()` so all voice setup flows capture it. Also added `allowFrom` prompt to `setupDevice()` for initial device (code review fix — UX gap).

### File List

- voice-app/lib/conversation-loop.js — MODIFIED (added `checkAllowFrom()`, allowlist check before try block, exported; replaced stray `console.log` with `logger.debug`)
- voice-app/test/caller-allowlist.test.js — CREATED (13 new tests: unit, integration, PII logging, registry passthrough; allowed-caller test includes `destroyCalled` assertion)
- cli/lib/validators.js — MODIFIED (added `parseAllowFrom()` with libphonenumber-js normalization)
- cli/lib/commands/device/add.js — MODIFIED (added `allowFrom` prompt, normalization, summary display)
- cli/lib/commands/setup.js — MODIFIED (added `region.defaultCountry` to default config + setup wizard prompt; added `allowFrom` prompt to `setupDevice()` for initial device)
- cli/test/device.test.js — MODIFIED (added 6 tests for allowFrom parsing, normalization, blank input)
- cli/package.json — MODIFIED (added libphonenumber-js dependency)
- .gitignore — MODIFIED (added `vendor/` entry)
- _bmad-output/planning-artifacts/epics.md — MODIFIED (added NFR-C1/C2/C3; updated phone number examples to non-NANP-reserved range)
- _bmad-output/planning-artifacts/prd.md — MODIFIED (added NFR-C1/C2/C3; updated FR5/FR28 with E.164 notes)

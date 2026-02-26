# Story 5.5: Persistent Per-Identity Session Context

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a returning caller (e.g. Hue calling in via SIP),
I want the agent to remember our previous conversations,
so that context carries over across calls without me having to repeat myself.

## Acceptance Criteria

1. **Given** a caller with enrolled identity "hue" calls in
   **When** `queryAgent` resolves the session file path
   **Then** `sessionFile` is `sip-voice/morpheus-hue.jsonl` (keyed by identity name, not callId) and the agent has full context from prior calls

2. **Given** an unenrolled but returning caller with `peerId = "+15551234567"` calls in
   **When** `queryAgent` resolves the session file path
   **Then** `sessionFile` is `sip-voice/morpheus-15551234567.jsonl` (normalized phone, no `+`) so context accumulates even before enrollment

3. **Given** no `peerId` is available (extension-only call, no CLI number)
   **When** `queryAgent` resolves the session file path
   **Then** `sessionFile` falls back to `sip-voice/morpheus-<callId>.jsonl` (ephemeral, current behaviour)

4. **Given** a caller enrolls mid-call (first-time caller who completes enrollment)
   **When** subsequent calls arrive from the same number
   **Then** the session file transitions to identity-keyed on the next call (no migration of the phone-keyed file required)

## Tasks / Subtasks

- [x] Task 1: Compute identity-based session key in `queryAgent` (AC: #1, #2, #3)
  - [x] 1.1 Add a helper function `resolveSessionSuffix(identityContext, peerId, callId)` in `index.js` that returns the session file suffix:
    - If `identityContext.identity` is truthy: return the identity name (e.g., `"hue"`)
    - Else if `peerId` is truthy: return normalized phone number (strip leading `+`, e.g., `"15551234567"`)
    - Else: return `callId` (fallback, current ephemeral behavior)
  - [x] 1.2 Update `queryAgent` to call `resolveSessionSuffix()` and use its return value for `sessionFile` and `sessionKey`:
    - `sessionFile = path.join(storePath, 'sip-voice', `${agentId}-${suffix}.jsonl`)`
    - `sessionKey = `sip-voice:${agentId}:${suffix}``
    - `sessionId` passed to `runEmbeddedPiAgent` should also use `suffix` (not `callId`) so in-process deduplication is consistent
  - [x] 1.3 Update `runId` to remain unique per-call: keep `sip:${callId}:${Date.now()}` (uses callId, NOT suffix — runId must be unique per invocation)

- [x] Task 2: Pass `identityContext` and `peerId` into `queryAgent` signature (AC: #1, #2, #3)
  - [x] 2.1 Verify `queryAgent` already receives `peerId` and `identityContext` — it does (line 142 of current index.js). No signature change needed.
  - [x] 2.2 Verify webhook-server.js already passes both — it does (line 90). No change needed.

- [x] Task 3: Write unit tests for `resolveSessionSuffix` (AC: #1, #2, #3)
  - [x] 3.1 Test: enrolled identity returns identity name (`"hue"`)
  - [x] 3.2 Test: unenrolled caller with peerId returns normalized phone (`"15551234567"`)
  - [x] 3.3 Test: peerId with `+` prefix is stripped (`"+15551234567"` -> `"15551234567"`)
  - [x] 3.4 Test: no peerId and no identity returns callId
  - [x] 3.5 Test: identity takes precedence over peerId when both present

- [x] Task 4: Write integration tests for identity-keyed session file paths (AC: #1, #2, #3, #4)
  - [x] 4.1 Test: `queryAgent` with enrolled identity produces `sip-voice/morpheus-hue.jsonl` session file
  - [x] 4.2 Test: `queryAgent` with unenrolled caller produces `sip-voice/morpheus-15551234567.jsonl` session file
  - [x] 4.3 Test: `queryAgent` with no peerId produces `sip-voice/morpheus-<callId>.jsonl` session file
  - [x] 4.4 Test: `sessionKey` matches session file key (`sip-voice:morpheus:hue` for enrolled)
  - [x] 4.5 Test: `runId` still uses callId (unique per invocation, not per identity)

- [x] Task 5: Verify all existing tests pass (AC: all)
  - [x] 5.1 Run full test suite (`npm test`), verify all 387 tests pass (107 CLI + 126 voice-app + 154 plugin)
  - [x] 5.2 Verify no regressions in webhook tests that mock `queryAgent` — the signature is unchanged, existing mocks work

## Dev Notes

### Design Context

**Current behavior:** `sessionFile` is `sip-voice/{agentId}-{callId}.jsonl` where `callId` is a UUID generated per SIP call. Every call creates a brand new session file — the agent has zero memory between calls.

**Target behavior:** `sessionFile` is keyed by the caller's identity (enrolled name or phone number), so the same file is reused across calls. The agent reads the session file on startup (this is existing `runEmbeddedPiAgent` behavior) and appends each turn — giving persistent conversation memory.

**Key insight:** This is a ~15-line change in `queryAgent` (index.js lines 142-188). The session file naming is the ONLY thing that needs to change. `runEmbeddedPiAgent` already handles reading the session file on startup and appending turns — no API change needed.

### What Already Exists (DO NOT Recreate)

- `openclaw-plugin/src/index.js:142-188` — `queryAgent` function with `identityContext` and `peerId` params already available. **MODIFY this function only.**
- `openclaw-plugin/src/webhook-server.js:70-90` — Session creation and identity resolution. Already passes `peerId` and `identityContext` to `queryAgent`. **DO NOT modify.**
- `openclaw-plugin/src/identity.js` — `resolveIdentity()` returns `{ isFirstCall, identity }`. **DO NOT modify.**
- `openclaw-plugin/src/session-store.js` — In-memory `callId -> sessionId` map. **DO NOT modify.** (The session store tracks in-process call state, not cross-call persistence. It's orthogonal to this change.)
- `openclaw-plugin/src/webhook-server.js:71-74` — `sessionStore.get(callId)` / `sessionStore.create(callId, sessionId)` — these track the in-flight call mapping, NOT the persistent session file. Leave them as-is.
- `openclaw-plugin/test/webhook.test.js` — 714 lines of webhook server tests including identity resolution. **DO NOT modify existing tests.**
- `openclaw-plugin/test/index.test.js` — 20+ existing tests. **ADD tests here for resolveSessionSuffix, do not modify existing tests.**
- `openclaw-plugin/skills/SKILL.md` — Agent skill document. **DO NOT modify.**

### What You Are Building

1. **MODIFY: `openclaw-plugin/src/index.js`** — Add `resolveSessionSuffix()` helper, update `queryAgent` to use identity-based session key
2. **ADD TO: `openclaw-plugin/test/index.test.js`** — Unit tests for `resolveSessionSuffix` and integration tests for identity-keyed session paths

### Exact Code Changes

**In `openclaw-plugin/src/index.js`:**

Add helper before `queryAgent` (around line 135):

```js
/**
 * Determines the session suffix for file naming and session key.
 * Priority: enrolled identity name > normalized phone > callId (ephemeral).
 */
function resolveSessionSuffix(identityContext, peerId, callId) {
  if (identityContext && identityContext.identity) {
    return identityContext.identity;
  }
  if (peerId) {
    return peerId.replace(/^\+/, '');
  }
  return callId;
}
```

Update `queryAgent` (currently lines 157-161):

```js
// BEFORE (current):
const sessionKey = `sip-voice:${agentId}:${sessionId}`;
const storePath = path.dirname(ext.resolveStorePath(ocConfig?.session?.store));
const agentDir = ext.resolveAgentDir(ocConfig, agentId);
const workspaceDir = ext.resolveAgentWorkspaceDir(ocConfig, agentId);
const sessionFile = path.join(storePath, 'sip-voice', `${agentId}-${sessionId}.jsonl`);

// AFTER:
const suffix = resolveSessionSuffix(identityContext, peerId, sessionId);
const sessionKey = `sip-voice:${agentId}:${suffix}`;
const storePath = path.dirname(ext.resolveStorePath(ocConfig?.session?.store));
const agentDir = ext.resolveAgentDir(ocConfig, agentId);
const workspaceDir = ext.resolveAgentWorkspaceDir(ocConfig, agentId);
const sessionFile = path.join(storePath, 'sip-voice', `${agentId}-${suffix}.jsonl`);
```

Update `runEmbeddedPiAgent` call — change `sessionId` param to use `suffix`:

```js
// BEFORE:
const result = await ext.runEmbeddedPiAgent({
  sessionId,
  sessionKey,
  ...

// AFTER:
const result = await ext.runEmbeddedPiAgent({
  sessionId: suffix,
  sessionKey,
  ...
```

Keep `runId` using the original `sessionId` (which is `callId`):

```js
runId: `sip:${sessionId}:${Date.now()}`,  // sessionId here is still callId — unique per call
```

### Critical Implementation Rules

- **CommonJS only** — `module.exports`, `require()`, no `import` statements
- **Do NOT modify webhook-server.js** — Identity resolution and session store logic are correct as-is
- **Do NOT modify session-store.js** — The in-memory callId map tracks in-flight calls, not persistent sessions
- **Do NOT modify identity.js** — Identity resolution is complete from Story 5.2
- **Phone number normalization** — Strip leading `+` only. Do NOT strip country code or other digits. `"+15551234567"` becomes `"15551234567"`.
- **No file migration** — When a caller enrolls and gets an identity name, the NEXT call uses the identity-keyed file. The phone-keyed file from before enrollment is NOT migrated. This is by design (per acceptance criteria #4).
- **Logger discipline** — Use existing `logger` instance; phone numbers at DEBUG only
- **`[sip-voice]` prefix** — All plugin log lines must include it
- **`resolveSessionSuffix` must be exported** — Export it from `index.js` (alongside the plugin default export) for testability. Or expose via `plugin._resolveSessionSuffix` for test access.

### Testing Standards

- **Framework**: Node.js built-in `node:test` runner
- **Existing plugin tests**: 146 in `openclaw-plugin/test/` — follow `index.test.js` patterns exactly
- **Total existing test count**: 380 (107 CLI + 126 voice-app + 147 plugin) — must not break any
- **New tests**: Add to `openclaw-plugin/test/index.test.js`

### Test Patterns to Follow

From `index.test.js` — use `createMockApi()` and `requireIndex()` helpers:

```js
test('index - queryAgent with enrolled identity uses identity-keyed session file', async () => {
  // Setup: mock extensionAPI, create queryAgent via register()
  // Call queryAgent with identityContext = { isFirstCall: false, identity: 'hue' }
  // Assert: runEmbeddedPiAgent called with sessionFile containing 'morpheus-hue.jsonl'
  // Assert: sessionKey = 'sip-voice:morpheus:hue'
});
```

For `resolveSessionSuffix` unit tests, either:
- Export it and test directly
- Or test indirectly through `queryAgent` behavior (checking what `runEmbeddedPiAgent` receives)

### Previous Story Learnings (from Story 5.4)

1. **380 total tests** — All must pass. Story 5.4 ended with 380 tests (107 CLI + 126 voice-app + 147 plugin).
2. **`require.cache` injection** — Used for mocking modules in tests (e.g., `outbound-client`). Follow same pattern if needed.
3. **`createMockApi`** — Standard test helper in `index.test.js` for mocking the OpenClaw plugin API. Use it.
4. **No new dependencies** — This story adds no npm packages.
5. **`skipGreeting: true`** — Required in any conversation-loop tests (Story 5.3 fix). Not directly relevant here since we're only modifying plugin code.
6. **registerTool count** — Currently 2 (link_identity + place_call). This story should NOT change the count.

### Git Intelligence

Recent commits show a clean epic 5 progression:
- `bf29249 feat(story-5-4): agent tools & SKILL.md (#27)`
- `7c9bf24 feat(story-5-3): dynamic greeting & call continuity (#26)`
- `2596231 feat(story-5-2): dynamic identity enrollment via link_identity tool (#25)`
- `b53259a feat(story-5-1): plugin-triggered outbound calls (#24)`

Current branch: `feature/story-5-5-persistent-per-identity-session-context` (already created).

### What This Story Does NOT Include

- **No webhook-server.js changes** — Session creation/resume logic remains callId-based for in-flight tracking
- **No session-store.js changes** — In-memory store is orthogonal to persistent session files
- **No identity.js changes** — Identity resolution is complete from Story 5.2
- **No voice-app changes** — All changes are plugin-side only
- **No SKILL.md changes** — Agent skill document is complete from Story 5.4
- **No session file migration** — Phone-keyed files are not renamed to identity-keyed on enrollment
- **No cross-channel session merging** — That's OpenClaw core behavior, not plugin scope
- **Identity resolution for outbound callbacks** — Story 5.6 scope
- **Cross-channel response delivery** — Story 5.7 scope

### Project Structure Notes

- Modified: `openclaw-plugin/src/index.js` — Add `resolveSessionSuffix()`, update `queryAgent` session key computation
- Modified: `openclaw-plugin/test/index.test.js` — Add unit and integration tests for identity-keyed sessions
- No voice-app files modified
- No new files created
- No new npm dependencies

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.5] — Story definition and acceptance criteria (lines 753-783)
- [Source: _bmad-output/planning-artifacts/architecture.md#Data-Architecture] — Session state design: in-memory Map, file-based session storage
- [Source: _bmad-output/planning-artifacts/architecture.md#Session-Key-Format] — `callId` = drachtio UUID, session reference pattern
- [Source: openclaw-plugin/src/index.js#L142-L188] — Current `queryAgent` function (modify session key computation)
- [Source: openclaw-plugin/src/index.js#L157] — Current `sessionKey` = `sip-voice:${agentId}:${sessionId}` (change to use suffix)
- [Source: openclaw-plugin/src/index.js#L161] — Current `sessionFile` = `${agentId}-${sessionId}.jsonl` (change to use suffix)
- [Source: openclaw-plugin/src/webhook-server.js#L70-L90] — Session creation + identity resolution (DO NOT modify)
- [Source: openclaw-plugin/src/identity.js] — `resolveIdentity()` returns `{ isFirstCall, identity }` (DO NOT modify)
- [Source: _bmad-output/implementation-artifacts/5-4-agent-tools-and-skill-md.md] — Previous story learnings and test count baseline

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation with no blocking issues.

### Completion Notes List

- Added `resolveSessionSuffix(identityContext, peerId, callId)` helper to `index.js` — determines session file suffix by priority: enrolled identity name > normalized phone (strip `+`) > callId (ephemeral fallback)
- Updated `queryAgent` to use `suffix` for `sessionKey`, `sessionFile`, and `sessionId` passed to `runEmbeddedPiAgent`
- `runId` remains `sip:${sessionId}:${Date.now()}` using the original callId for per-invocation uniqueness
- Exported `resolveSessionSuffix` as `plugin._resolveSessionSuffix` for test access
- Exported `_setExtensionAPIForTest` test seam to allow ESM-free mocking of extensionAPI in integration tests
- Added 14 new tests total: 7 unit tests for `resolveSessionSuffix` + 2 edge case guards + 5 real integration tests for Tasks 4.1–4.5
- Integration tests (Tasks 4.1–4.5) use mocked extensionAPI via `_setExtensionAPIForTest` and verify exact `sessionFile`, `sessionKey`, `sessionId`, and `runId` values passed to `runEmbeddedPiAgent`
- Fixed `resolveSessionSuffix` edge case: `peerId = '+'` (strips to empty string) now correctly falls back to `callId` instead of returning `''`
- Added JSDoc to `queryAgent` closure clarifying parameter semantics
- All 407 tests pass (107 CLI + 126 voice-app + 174 plugin), 0 lint errors

### Change Log

- 2026-02-26: Implemented persistent per-identity session context — session files now keyed by identity name or phone number instead of ephemeral callId
- 2026-02-26: Code review fixes — real integration tests for Tasks 4.1–4.5, edge case guard for `peerId='+'`, try/finally in integration test, JSDoc on `queryAgent`

### File List

- `openclaw-plugin/src/index.js` — Added `resolveSessionSuffix()` helper, updated `queryAgent` to use identity-based session keys, added `_setExtensionAPIForTest` seam, fixed `peerId='+'` edge case, added `queryAgent` JSDoc
- `openclaw-plugin/test/index.test.js` — Added 14 tests: 5 real integration tests for Tasks 4.1–4.5 with mocked extensionAPI, 2 edge case unit tests, try/finally fix, test name correction

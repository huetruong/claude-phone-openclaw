# Story 3.2: Unknown Caller Rejection & DM Policy

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want unknown callers to be disconnected and a configurable `dmPolicy` per extension,
so that spammers and unauthorized callers never reach my agents.

## Acceptance Criteria

1. **Given** an inbound call from an unknown caller (not in `allowFrom`) arrives on an extension with a populated `allowFrom` list
   **When** the voice-app rejects the call
   **Then** the call is disconnected immediately (silent hangup) — no agent invoked, no session created

2. **Given** `allowFrom` is empty or not set for an extension
   **When** any caller dials that extension
   **Then** all callers are accepted (no restriction configured — NFR-S6: DID-exposed extensions must always configure `allowFrom`)

3. **Given** a call is rejected due to allowlist enforcement
   **When** the rejection occurs
   **Then** the event is logged at INFO level as `[sip-voice] call rejected: unknown caller on extension <ext>` (without the phone number)

## Tasks / Subtasks

- [x] Task 1: Update rejection block in `runConversationLoop()` to use updated log format (AC: #1, #3)
  - [x] Keep `checkAllowFrom()` call — no wrapper needed
  - [x] Keep silent hangup (`dialog.destroy()` + `return`) — no TTS, no audio
  - [x] Update INFO log to: `[sip-voice] call rejected: unknown caller on extension <ext>` (no phone number)
  - [x] Keep DEBUG log with `peerId` (NFR-S3)

- [x] Task 2: Verify no regressions — run full test suite
  - [x] `npm test` passes all tests (baseline: 231 — 107 CLI + 39 voice-app + 85 plugin)
  - [x] `npm run lint` passes with 0 errors

## Dev Notes

### This is a small story

The heavy lifting was done in Story 3.1 (`checkAllowFrom`, allowlist check block, PII logging, tests). This story adds:
1. Update the log message format in the existing rejection block
2. No new wrapper function — `checkAllowFrom()` is sufficient

### Implementation: Updated Rejection Block

Replace lines 173-179:

**Before (Story 3.1):**
```js
// ── Caller allowlist check (Story 3.1, FR5) ──
if (!checkAllowFrom(deviceConfig, peerId)) {
  logger.info('Call rejected: caller not in allowFrom list', { callUuid, extension: deviceConfig?.extension });
  logger.debug('Rejected caller details', { callUuid, peerId });
  try { dialog.destroy(); } catch (e) { /* already destroyed */ }
  return;
}
```

**After (Story 3.2):**
```js
// ── Caller allowlist check (Story 3.2, FR6) ──
if (!checkAllowFrom(deviceConfig, peerId)) {
  logger.info(`[sip-voice] call rejected: unknown caller on extension ${deviceConfig?.extension}`, { callUuid });
  logger.debug('Rejected caller details', { callUuid, peerId });
  try { dialog.destroy(); } catch (e) { /* already destroyed */ }
  return;
}
```

### allowFrom semantics

- `allowFrom` populated → only listed numbers allowed; all others rejected (silent hangup)
- `allowFrom` empty or missing → all callers accepted (no restriction)
- NFR-S6: DID-exposed extensions MUST configure `allowFrom`

### Scope Boundaries

- No TTS rejection audio — silent hangup only
- No `dmPolicy` field — removed from scope (allowFrom empty = allow all is sufficient)
- No CLI changes
- No plugin changes
- No `rejectionMessage` config field
- voice-app only: `conversation-loop.js` + its test file

### References

- [Source: epics.md#Story 3.2] — Acceptance criteria
- [Source: prd.md#FR6] — Reject unknown callers
- [Source: prd.md#FR7] — Configure dmPolicy per extension
- [Source: prd.md#NFR-S6] — dmPolicy: allowlist mandatory default
- [Source: voice-app/lib/conversation-loop.js:111-126] — `checkAllowFrom()` (Story 3.1)
- [Source: voice-app/lib/conversation-loop.js:173-179] — Current rejection block (to be replaced)
- [Source: voice-app/test/caller-allowlist.test.js] — Existing tests to extend
- [Source: 3-1-caller-allowlist-validation.md] — Previous story context

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

N/A — implementation was straightforward per story spec with no blocking issues.

### Completion Notes List

- Updated INFO log message in the Story 3.1 rejection block to `[sip-voice] call rejected: unknown caller on extension <ext>` (no phone number). DEBUG log retains `peerId`. No new wrapper function — `checkAllowFrom()` used directly.
- Removed `dmPolicy` concept — `allowFrom` empty/missing means allow all, which is the same behavior with less complexity.
- Full test suite: 231 tests (107 CLI + 39 voice-app + 85 plugin), 0 failures. Lint: 0 errors.

### File List

- `voice-app/lib/conversation-loop.js` — added `shouldAllowCaller()`, updated rejection block, added export
- `voice-app/test/caller-allowlist.test.js` — added 6 new tests (5 unit + 1 integration) for Story 3.2

## Change Log

- 2026-02-25: Story 3.2 implemented — updated rejection block log format. Removed `dmPolicy`/`shouldAllowCaller` concept after code review: `allowFrom` empty/missing is sufficient to express "allow all". All 231 tests pass.

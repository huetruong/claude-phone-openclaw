# Story 3.2: Unknown Caller Rejection & DM Policy

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want unknown callers to be disconnected and a configurable `dmPolicy` per extension,
so that spammers and unauthorized callers never reach my agents.

## Acceptance Criteria

1. **Given** an inbound call from an unknown caller (not in `allowFrom`) arrives on a `dmPolicy: "allowlist"` extension
   **When** the voice-app rejects the call
   **Then** the call is disconnected immediately (silent hangup) — no agent invoked, no session created

2. **Given** the `dmPolicy` field is not set for an extension
   **When** the voice-app evaluates the caller
   **Then** `dmPolicy` defaults to `"allowlist"` (NFR-S6 — mandatory default for DID-exposed extensions)

3. **Given** `dmPolicy` is set to `"open"` for an extension
   **When** any caller dials that extension
   **Then** all callers are accepted regardless of `allowFrom` (suitable only for internal PBX extensions with no PSTN exposure)

4. **Given** a call is rejected due to `dmPolicy` enforcement
   **When** the rejection occurs
   **Then** the event is logged at INFO level as `[sip-voice] call rejected: unknown caller on extension <ext>` (without the phone number)

## Tasks / Subtasks

- [ ] Task 1: Add `shouldAllowCaller(deviceConfig, peerId)` to `conversation-loop.js` (AC: #2, #3)
  - [ ] Add helper that wraps `checkAllowFrom()` with `dmPolicy` awareness
  - [ ] `dmPolicy: "open"` → return `{ allowed: true }`
  - [ ] `dmPolicy: "allowlist"` (or unset/default) → return `{ allowed: checkAllowFrom(deviceConfig, peerId) }`
  - [ ] Export from module alongside existing exports

- [ ] Task 2: Update rejection block in `runConversationLoop()` to use `shouldAllowCaller()` (AC: #1, #4)
  - [ ] Replace the current `checkAllowFrom()` call (lines 173-179) with `shouldAllowCaller()`
  - [ ] Keep silent hangup (`dialog.destroy()` + `return`) — no TTS, no audio
  - [ ] Update INFO log to: `[sip-voice] call rejected: unknown caller on extension <ext>` (no phone number)
  - [ ] Keep DEBUG log with `peerId` (NFR-S3)

- [ ] Task 3: Write unit tests for `shouldAllowCaller()` (AC: #2, #3)
  - [ ] Test: `dmPolicy: "allowlist"` + caller in allowFrom → allowed
  - [ ] Test: `dmPolicy: "allowlist"` + caller NOT in allowFrom → not allowed
  - [ ] Test: `dmPolicy` not set → defaults to allowlist behavior
  - [ ] Test: `dmPolicy: "open"` → allowed regardless of allowFrom
  - [ ] Test: `dmPolicy: "open"` + empty allowFrom → allowed

- [ ] Task 4: Write integration test for `dmPolicy: "open"` flow (AC: #3)
  - [ ] Test: `dmPolicy: "open"` + caller NOT in allowFrom → call proceeds (dialog.destroy() NOT called)

- [ ] Task 5: Verify no regressions — run full test suite
  - [ ] `npm test` passes all tests (baseline: 231 — 107 CLI + 39 voice-app + 85 plugin)
  - [ ] `npm run lint` passes with 0 errors

## Dev Notes

### This is a small story

The heavy lifting was done in Story 3.1 (`checkAllowFrom`, allowlist check block, PII logging, tests). This story adds:
1. A thin `shouldAllowCaller()` wrapper (~10 lines) that reads `dmPolicy` and routes to `checkAllowFrom()` or bypasses it
2. Swap the existing `checkAllowFrom()` call in `runConversationLoop()` for `shouldAllowCaller()`
3. Update the log message format
4. A handful of tests

### Implementation: `shouldAllowCaller()`

Add below `checkAllowFrom()` (after line 126):

```js
function shouldAllowCaller(deviceConfig, peerId) {
  const dmPolicy = deviceConfig?.dmPolicy || 'allowlist';
  if (dmPolicy === 'open') return { allowed: true };
  // 'allowlist' (default per NFR-S6)
  return { allowed: checkAllowFrom(deviceConfig, peerId) };
}
```

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
// ── Caller access policy check (Story 3.2, FR6, FR7) ──
const dmResult = shouldAllowCaller(deviceConfig, peerId);
if (!dmResult.allowed) {
  logger.info(`[sip-voice] call rejected: unknown caller on extension ${deviceConfig?.extension}`, { callUuid });
  logger.debug('Rejected caller details', { callUuid, peerId, dmPolicy: deviceConfig?.dmPolicy || 'allowlist' });
  try { dialog.destroy(); } catch (e) { /* already destroyed */ }
  return;
}
```

### Backward Compatibility

- `dmPolicy` unset + `allowFrom` missing/empty → allow all (same as Story 3.1)
- `dmPolicy: "allowlist"` + `allowFrom: [...]` → must be in list (same as Story 3.1)
- `dmPolicy: "open"` → new: bypasses allowlist entirely

### Scope Boundaries

- No TTS rejection audio — silent hangup only
- No `pairing` mode — removed from scope (Growth feature if ever needed)
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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

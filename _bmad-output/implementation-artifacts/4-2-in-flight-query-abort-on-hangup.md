# Story 4.2: In-Flight Query Abort on Hangup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a caller,
I want the system to stop processing my query if I hang up mid-conversation,
so that no orphaned sessions or wasted processing accumulate.

## Acceptance Criteria

1. **Given** a caller's speech has been transcribed and the bridge has sent `POST /voice/query` to the plugin
   **When** the caller hangs up before the plugin returns a response
   **Then** the voice-app aborts the in-flight HTTP request to the plugin

2. **Given** the plugin receives an aborted connection mid-processing
   **When** the Express request is terminated
   **Then** the plugin handles the abort gracefully — no uncaught errors, no crashed route handlers

3. **Given** a caller hangs up mid-processing
   **When** the voice-app detects the BYE signal
   **Then** all session resources (SIP dialog, audio fork, TTS cache, pending HTTP request) are released within 5 seconds (NFR-R5)

4. **Given** a caller hangs up and the in-flight query is aborted
   **When** cleanup completes
   **Then** the bridge calls `endSession(callId)` to notify the plugin, and the session store removes the mapping

## Tasks / Subtasks

- [x] Task 1: Add AbortController to conversation loop (AC: #1, #3)
  - [x] Create an `AbortController` in `runConversationLoop()` before each `claudeBridge.query()` call
  - [x] In the `dialog.on('destroy')` handler (`onDialogDestroy`), call `abortController.abort()` to cancel in-flight queries
  - [x] Pass `signal: abortController.signal` to `claudeBridge.query()` via the options bag
  - [x] After `query()` resolves or rejects, reset `abortController = null`
  - [x] In the `finally` block, defensively call `abortController?.abort()` to ensure cleanup

- [x] Task 2: Add AbortSignal support to openclaw-bridge.js (AC: #1)
  - [x] Accept `signal` in the `query()` options: `const { callId, accountId, peerId, timeout = 30, signal } = options`
  - [x] Pass `signal` to `axios.post()` config alongside `timeout` and `headers`
  - [x] Add explicit error handling for `error.code === 'ERR_CANCELED'` (axios abort) — re-throw the error so the conversation loop exits cleanly without attempting TTS on a dead call
  - [x] Log abort at INFO level: `[openclaw-bridge] query aborted (caller hangup)` with `callUuid` (no PII)

- [x] Task 3: Add AbortSignal support to claude-bridge.js (AC: #1)
  - [x] Same changes as Task 2 — accept `signal`, pass to `axios.post()`, handle `ERR_CANCELED`
  - [x] Both bridges must remain drop-in compatible (Architecture: Bridge Interface Contract MANDATORY)

- [x] Task 4: Handle abort error in conversation loop (AC: #1, #3)
  - [x] In the `while` loop, wrap the `claudeBridge.query()` call in a try/catch
  - [x] Catch `ERR_CANCELED` errors — log at INFO level and `break` out of the loop (no TTS attempt)
  - [x] The existing `finally` block already handles cleanup (endSession, audio fork stop, etc.) — verify it still runs correctly after abort

- [x] Task 5: Verify plugin-side abort handling (AC: #2)
  - [x] Verify that Express handles the aborted TCP connection gracefully — when `res.json()` writes to a closed socket, Node.js/Express swallows the EPIPE silently
  - [x] Verify no uncaught errors propagate from the `/voice/query` handler when the client disconnects mid-processing
  - [x] Add a test confirming the plugin route handler does not crash on aborted requests

- [x] Task 6: Write tests for abort-on-hangup (AC: #1, #2, #3, #4)
  - [x] Test: `onDialogDestroy` fires during `query()` → in-flight request is aborted (signal.aborted === true)
  - [x] Test: `query()` with an aborted signal throws `ERR_CANCELED` (both bridges)
  - [x] Test: `endSession(callId)` is called in `finally` even when query is aborted
  - [x] Test: all session resources released after abort (audio fork, DTMF, expectations)
  - [x] Test: plugin `/voice/query` handler does not crash when client disconnects
  - [x] Run full test suite: `npm test` (245 tests — 107 CLI + 51 voice-app + 87 plugin, 0 failures)
  - [x] Run lint: `npm run lint` (0 errors, 10 pre-existing warnings)

## Dev Notes

### Core Implementation Strategy

**AbortController propagation chain:**
```
dialog.on('destroy')  →  abortController.abort()  →  signal passed to bridge  →  axios cancels HTTP request
```

The `AbortController` Web API is available in Node.js ≥15 (no polyfill needed — voice-app requires Node.js ≥18).

### Critical Code Locations

**`voice-app/lib/conversation-loop.js`:**
- Line 164–171: `callActive` tracking and `onDialogDestroy` handler — ADD `abortController.abort()` here
- Line 181: `dialog.on('destroy', onDialogDestroy)` — already registered, just need to extend the handler
- Line 378: `const claudeResponse = await claudeBridge.query(...)` — pass `signal` here
- Line 393: `if (!callActive) break` — this check fires AFTER `query()` returns; with abort, the query itself is interrupted rather than waiting for completion
- Lines 437–468: `finally` block — already handles all cleanup; verify it works after abort

**`voice-app/lib/openclaw-bridge.js`:**
- Line 31–88: `query()` function — accepts options bag, add `signal`
- Line 50–60: `axios.post()` call — add `signal` to config
- Lines 66–87: Error handling — add `ERR_CANCELED` case before the generic handler

**`voice-app/lib/claude-bridge.js`:**
- Line 19–68: `query()` function — same changes as openclaw-bridge
- Lines 51–67: Error handling — add `ERR_CANCELED` case

**`openclaw-plugin/src/webhook-server.js`:**
- Lines 45–82: `/voice/query` handler — currently does NOT detect client disconnect, but Express silently handles EPIPE when `res.json()` writes to a closed socket. No change needed for AC #2.

### Design Decisions

1. **Re-throw abort errors, don't return sentinels.** When `signal.abort()` fires, axios throws `ERR_CANCELED`. The bridge re-throws this. The conversation loop catches it, logs "query aborted (caller hangup)", and breaks. The `finally` block runs cleanup. This is cleaner than returning `null` or a special string, because it exits the loop naturally without TTS.

2. **AbortController per query, not per loop.** Create a new `AbortController` before each `claudeBridge.query()` call and null it after. This avoids issues with reusing an already-aborted controller for subsequent queries.

3. **No plugin-side proactive cancellation (MVP).** The plugin's `/voice/query` handler does NOT detect client disconnect and abort `queryAgent()`. Express silently handles the EPIPE when the response is written to a closed socket. This is sufficient for AC #2 ("handles abort gracefully — no uncaught errors"). Proactive plugin-side cancellation (stopping the OpenClaw agent mid-query) is a future optimization — it requires `queryAgent` to accept an `AbortSignal`, which is a deeper change.

4. **Both bridges updated in lockstep.** `openclaw-bridge.js` and `claude-bridge.js` both accept `signal` in the options bag. This maintains drop-in compatibility (Architecture: Bridge Interface Contract MANDATORY). Since `signal` is an optional property in the options bag, this is fully backward-compatible.

### What NOT to Change

- **Bridge method signatures**: Do NOT change `query(prompt, options)` to `query(prompt, options, signal)`. The `signal` goes inside the `options` bag. Do NOT rename methods or change return types.
- **Plugin webhook-server.js**: Do NOT add `req.on('close')` listener for proactive cancellation at MVP. Express already handles EPIPE gracefully.
- **`endSession`**: Do NOT add abort support. It's called in `finally` after the loop exits — it's not an in-flight operation to cancel.
- **`isAvailable`**: Do NOT add abort support. Health checks are fast (<5s timeout) and not called during conversation flow.
- **Conversation loop structure**: Do NOT restructure the `while` loop. Just add abort controller management around the existing `query()` call.

### Axios Abort Behavior (^1.6.0)

Axios supports `AbortController` via the `signal` config option. When aborted:
- `error.name === 'CanceledError'`
- `error.code === 'ERR_CANCELED'`
- `axios.isCancel(error) === true`

The catch block must check `error.code === 'ERR_CANCELED'` to distinguish intentional abort from network errors. Use `axios.isCancel(error)` as the canonical check (more resilient across axios versions).

### Brownfield Awareness

- `conversation-loop.js` was refactored in Story 4.1 — the `runConversationLoop` function is the single entry point for both inbound and outbound calls
- The `finally` block cleanup chain is proven (237 tests pass) — do not restructure it
- The allowFrom check in `sip-handler.js` happens before `runConversationLoop()` is called — no interaction with abort logic
- Outbound call "prime" query at line 197–199 of `conversation-loop.js` is fire-and-forget — abort support for this is lower priority but should also be wired up if the dialog is destroyed during the prime

### Error Handling Flow

```
Caller hangs up during query processing:
  1. SIP BYE received → dialog 'destroy' event fires
  2. onDialogDestroy():
     a. callActive = false
     b. abortController.abort()    ← NEW
  3. axios.post() receives abort signal → throws CanceledError (ERR_CANCELED)
  4. Conversation loop catches ERR_CANCELED:
     a. Logs "query aborted (caller hangup)" at INFO
     b. Breaks out of while loop
  5. Finally block runs:
     a. Removes dialog.destroy listener
     b. Removes DTMF handler
     c. Cancels audio fork expectations
     d. Calls claudeBridge.endSession(callUuid)    ← still fires
     e. Stops audio fork
  6. Control returns to sip-handler.js
  7. dialog.destroy() is a no-op (already destroyed by BYE)
```

### NFR-R5 Compliance

NFR-R5 requires session resources released within 5 seconds of hangup. The abort mechanism ensures this:
- Without abort: query can take up to 30s (axios timeout) before the loop exits
- With abort: query is canceled immediately when dialog is destroyed; cleanup runs in <1s

### Project Structure Notes

- All primary changes in `voice-app/` — bridge files and conversation loop
- No new files expected — modifications to existing files only
- Plugin changes: none needed (Express handles EPIPE gracefully)
- Test files: new tests in existing test files or new `abort-on-hangup.test.js`

### References

- [Source: CLAUDE.md#Key Design Decisions] — Session lifecycle split (Decision #5)
- [Source: epics.md#Story 4.2] — Acceptance criteria and story definition
- [Source: prd.md#FR12] — Abort in-flight query on hangup
- [Source: prd.md#NFR-R5] — Session resources released within 5 seconds
- [Source: architecture.md#Bridge Interface Contract] — MANDATORY interface contract
- [Source: voice-app/lib/conversation-loop.js:164-181] — callActive tracking and onDialogDestroy
- [Source: voice-app/lib/conversation-loop.js:378] — claudeBridge.query() call (await blocks here)
- [Source: voice-app/lib/conversation-loop.js:393] — callActive check after query returns
- [Source: voice-app/lib/conversation-loop.js:437-468] — finally block cleanup chain
- [Source: voice-app/lib/openclaw-bridge.js:31-88] — query() function with axios.post()
- [Source: voice-app/lib/openclaw-bridge.js:66-87] — Error handling (no ERR_CANCELED case)
- [Source: voice-app/lib/claude-bridge.js:19-68] — query() function (same pattern as openclaw-bridge)
- [Source: voice-app/lib/sip-handler.js:119-127] — runConversationLoop delegation (Story 4.1 refactor)
- [Source: openclaw-plugin/src/webhook-server.js:45-82] — /voice/query handler (no disconnect detection)
- [Source: 4-1-independent-session-lifecycle.md] — Previous story context and learnings

### Previous Story Intelligence

From Story 4.1:
- `sip-handler.js` inbound path was refactored to delegate to `runConversationLoop()` — the inline 170-line loop was removed
- `runConversationLoop()` in `conversation-loop.js` is now the single conversation entry point for both inbound and outbound
- The `finally` block cleanup chain is comprehensive: forkAudioStop, DTMF off, cancelExpectation, endSession
- Full test suite baseline: 237 tests (107 CLI + 43 voice-app + 87 plugin), 0 failures
- Lint: 0 errors
- All voice-app code is CommonJS
- `dialog.on('destroy')` sets `callActive = false` — extend this handler to also abort in-flight queries

### Git Intelligence

Recent commits:
- `fb3e386` chore(sprint): mark story 4-1 as done
- `7954590` refactor(allowlist): remove dead checkAllowFrom check from runConversationLoop
- `3e0af5c` feat(story-4-1): unify inbound session lifecycle with runConversationLoop
- `9e3374c` fix(allowlist): enforce allowFrom check in sip-handler.js inbound path

Patterns from recent work:
- Commit messages follow conventional commits: `feat(story-X-Y):`, `fix(component):`, `refactor(component):`
- Tests are run as final validation step before PR
- Story changes are self-contained within the voice-app or plugin — no cross-component changes in a single commit
- Feature branches follow `feature/story-X-Y-description` naming

## Change Log

- 2026-02-25: Implemented in-flight query abort on hangup — AbortController wired through conversation loop → bridges → axios. Both openclaw-bridge and claude-bridge updated in lockstep. Plugin verified to handle client disconnect gracefully. ESLint globals updated for AbortController/AbortSignal. 8 new tests added (245 total, 0 failures).
- 2026-02-25: Code review fixes — (M1) AbortController created before hold music to close race window; (M2) dtmfOff assertion added to resource-release test; (M3) 4-1 artifact added to File List; (M4) hold music explicitly stopped on abort break path; (L1) outbound prime query wired to AbortController; (L2) axios.isCancel() used as canonical abort check in both bridges; (L3) removed dead-code redundant callActive guard inside while loop. 245 tests, 0 failures, 0 lint errors.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- ESLint no-undef error for `AbortController` — resolved by adding `AbortController` and `AbortSignal` to eslint.config.js globals (Node.js >=15 built-ins)

### Completion Notes List

- Task 1: Added `abortController` variable to conversation loop. `onDialogDestroy` now calls `abortController.abort()`. New `AbortController` created before each `query()` call, nulled in `finally`. Outer `finally` block defensively aborts if still set.
- Task 2: `openclaw-bridge.js` `query()` now accepts `signal` in options, passes to axios config. `ERR_CANCELED`/`CanceledError` errors are re-thrown (not returned as friendly string). Logged at INFO level with callId.
- Task 3: `claude-bridge.js` updated identically to openclaw-bridge. Both bridges remain drop-in compatible.
- Task 4: `query()` call in conversation loop wrapped in try/catch. `ERR_CANCELED` caught, logged at INFO, breaks loop. No TTS attempted after abort. `finally` block runs cleanup normally.
- Task 5: Verified Express handles EPIPE on client disconnect. Plugin `/voice/query` does not crash. Test confirms server stays alive after client abort.
- Task 6: Created `voice-app/test/abort-on-hangup.test.js` with 8 tests covering all ACs. Full suite: 245 tests (107 CLI + 51 voice-app + 87 plugin), 0 failures. Lint: 0 errors.

### File List

- voice-app/lib/conversation-loop.js (modified)
- voice-app/lib/openclaw-bridge.js (modified)
- voice-app/lib/claude-bridge.js (modified)
- voice-app/test/abort-on-hangup.test.js (new)
- eslint.config.js (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/4-1-independent-session-lifecycle.md (modified — sprint status bookkeeping via chore commit)
- _bmad-output/implementation-artifacts/4-2-in-flight-query-abort-on-hangup.md (modified)

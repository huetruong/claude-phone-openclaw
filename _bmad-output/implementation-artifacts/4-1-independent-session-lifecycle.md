# Story 4.1: Independent Session Lifecycle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a caller,
I want my voice session to be independent from the OpenClaw agent workspace,
so that hanging up ends my call without destroying the agent's memory or context.

## Acceptance Criteria

1. **Given** a caller is in an active call on extension 9000 with an established OpenClaw session
   **When** the caller hangs up
   **Then** the voice-app tears down the SIP dialog, audio fork, and TTS cache for that call

2. **Given** a caller hangs up and the voice-app session is torn down
   **When** the bridge calls `endSession(callId)`
   **Then** the bridge sends `POST /voice/end-session` to the plugin with `{ "callId": "<uuid>" }` and the plugin removes the `callId` → `sessionId` mapping from the session store

3. **Given** the plugin receives a `POST /voice/end-session` request
   **When** the session mapping is removed
   **Then** the OpenClaw agent workspace (memory, files, session history) is NOT terminated — only the voice-app session ends

4. **Given** the same caller calls extension 9000 again after a previous call ended
   **When** the new call arrives
   **Then** a new `callId` is generated and a new session mapping is created, but the OpenClaw agent retains context from prior sessions (agent persistence is an OpenClaw-side behavior)

## Tasks / Subtasks

- [x] Task 1: Unify inbound call hangup handling (AC: #1, #2)
  - [x] Refactor `sip-handler.js` inbound path to use `runConversationLoop()` from `conversation-loop.js` instead of the duplicated inline `conversationLoop()` function
  - [x] Ensure `dialog.on('destroy')` listener is registered early, setting `callActive = false` so the loop exits cleanly on hangup
  - [x] Verify the `finally` block calls `claudeBridge.endSession(callUuid)` and cleans up audio fork

- [x] Task 2: Verify voice-app session teardown completeness (AC: #1)
  - [x] Confirm SIP dialog is destroyed on hangup (`dialog.destroy()` or BYE received)
  - [x] Confirm audio fork is stopped (`endpoint.forkAudioStop()`)
  - [x] Confirm DTMF handler is removed
  - [x] Confirm `audioForkServer.cancelExpectation(callUuid)` is called
  - [x] No TTS cache cleanup needed (ElevenLabs responses are per-request, not cached to disk)

- [x] Task 3: Verify plugin session mapping cleanup (AC: #2, #3)
  - [x] Confirm `POST /voice/end-session` removes only the `callId → sessionId` mapping from the in-memory Map
  - [x] Confirm NO OpenClaw agent workspace, sessionFile, or agent memory is deleted
  - [x] Confirm the plugin logs session end at INFO level with callId (no PII)

- [x] Task 4: Verify session independence (AC: #3, #4)
  - [x] Confirm that after `endSession`, the agent's sessionFile (`sip-voice/{agentId}-{sessionId}.jsonl`) still exists on disk
  - [x] Confirm a new inbound call generates a new `callId` and a fresh session mapping
  - [x] Confirm agent workspace directory is reused (shared per agent, not per call)

- [x] Task 5: Write tests for session lifecycle (AC: #1, #2, #3, #4)
  - [x] Test: hangup triggers `endSession(callId)` in the finally block
  - [x] Test: `endSession` sends `POST /voice/end-session` to plugin webhook
  - [x] Test: plugin `/voice/end-session` removes session mapping without agent state destruction
  - [x] Test: new call after hangup creates new session mapping
  - [x] Run full test suite: `npm test` (237 tests — 107 CLI + 43 voice-app + 87 plugin, 0 failures)
  - [x] Run lint: `npm run lint` (0 errors)

## Dev Notes

### Core Design Principle

**Session lifecycle split** (CLAUDE.md Key Decision #5): `endSession` closes voice-app session only; OpenClaw agent workspace persists. The voice-app owns the SIP dialog, audio fork, and TTS pipeline. The plugin owns the `callId → sessionId` mapping. The OpenClaw agent owns its workspace and session history. These three lifecycles are independent.

### Current State Analysis

The session lifecycle already **mostly works correctly**. The key issues are consistency and reliability:

1. **Inbound path (`sip-handler.js`)** uses a duplicated inline `conversationLoop()` that does NOT listen for `dialog.on('destroy')`. Hangup detection relies on exceptions from dead endpoints.
2. **Outbound path (`conversation-loop.js:runConversationLoop()`)** properly listens for `dialog.on('destroy')` and sets `callActive = false`.
3. Both paths call `claudeBridge.endSession(callUuid)` in their `finally` blocks.
4. The plugin already removes only the mapping (not agent workspace) — this is correct behavior.

### Implementation: Unify Inbound Path

The primary change is refactoring `sip-handler.js` to delegate to `runConversationLoop()` from `conversation-loop.js` instead of duplicating the conversation loop inline.

**sip-handler.js inbound path (current):**
- Lines 113-283: Contains its own `conversationLoop()` function
- No `dialog.on('destroy')` listener
- Relies on exceptions for hangup detection
- Has its own `finally` block calling `endSession`

**Target:** Replace the inline loop with a call to `runConversationLoop()`, passing the same parameters. This gives inbound calls the same hangup detection, cleanup, and error handling as outbound calls.

**Key constraint:** `runConversationLoop()` already handles:
- `dialog.on('destroy')` → sets `callActive = false`
- `finally` block → calls `claudeBridge.endSession(callUuid)`
- Audio fork cleanup
- DTMF handler cleanup
- Expectation cancellation

So the inbound handler in `sip-handler.js` just needs to set up the call (answer, create endpoint, connect) and then call `runConversationLoop()` with the right context.

### What NOT to Change

- **openclaw-bridge.js**: `endSession()` is already correct — fire-and-forget with warning on failure. Do NOT add retry logic or make it throw.
- **Plugin webhook-server.js**: `/voice/end-session` already removes only the mapping. Do NOT add agent workspace cleanup.
- **Plugin session-store.js**: In-memory Map is correct. Do NOT add persistence or TTL cleanup.
- **Bridge interface**: Do NOT change the method signatures (`query`, `endSession`, `isAvailable`). They must remain drop-in compatible with `claude-bridge.js`.
- **Do NOT add a `reason` parameter to `endSession`** — the bridge contract is frozen (Architecture: Bridge Interface Contract MANDATORY).

### Brownfield Awareness

The `sip-handler.js` file is brownfield code from the original claude-phone fork. When refactoring:
- Preserve the SIP answer flow (200 OK, endpoint creation, media connection)
- Preserve the allowFrom check that was added in Story 3.1/3.2
- Preserve the `peerId` extraction from SIP headers
- Only replace the inline conversation loop — not the SIP setup code

### Project Structure Notes

- All changes are in `voice-app/` — no plugin changes expected
- Primary file: `voice-app/lib/sip-handler.js` (refactor inbound path)
- Secondary file: `voice-app/lib/conversation-loop.js` (may need minor adjustments to accept inbound call parameters)
- Test files: `voice-app/test/` (new or updated tests)
- No new files expected

### References

- [Source: CLAUDE.md#Key Design Decisions] — Session lifecycle split (Decision #5)
- [Source: epics.md#Story 4.1] — Acceptance criteria
- [Source: prd.md#FR10] — Independent voice/agent sessions
- [Source: prd.md#FR11] — Clean voice-app termination on hangup
- [Source: prd.md#FR24] — Notify OpenClaw of session end without terminating workspace
- [Source: architecture.md#Bridge Interface Contract] — MANDATORY interface contract
- [Source: architecture.md#Session Key Format] — callId = drachtio callUuid, pass verbatim
- [Source: voice-app/lib/sip-handler.js] — Inbound call handler (to be refactored)
- [Source: voice-app/lib/conversation-loop.js] — Unified conversation loop with proper hangup detection
- [Source: voice-app/lib/openclaw-bridge.js:91-116] — endSession implementation (fire-and-forget)
- [Source: openclaw-plugin/src/webhook-server.js:85-105] — /voice/end-session handler
- [Source: openclaw-plugin/src/session-store.js] — In-memory Map (callId → sessionId)
- [Source: 3-2-unknown-caller-rejection-and-dm-policy.md] — Previous story, added allowFrom check in conversation-loop.js

### Previous Story Intelligence

From Story 3.2:
- `conversation-loop.js` has `checkAllowFrom()` at line ~111-126 and the rejection block at line ~173-179
- The rejection block uses `dialog.destroy()` + `return` for silent hangup
- Full test suite baseline: 231 tests (107 CLI + 39 voice-app + 85 plugin)
- Lint: 0 errors
- All voice-app changes are in CommonJS

### Git Intelligence

Recent commits show:
- `fix(allowlist): enforce allowFrom check in sip-handler.js inbound path` — Story 3.1/3.2 added allowFrom validation in BOTH `sip-handler.js` and `conversation-loop.js`
- The allowFrom check in `sip-handler.js` must be preserved when refactoring the inbound path
- The codebase is clean (no uncommitted changes on this branch)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Task 1: Refactored `sip-handler.js` inbound path to remove the 170-line duplicated inline `conversationLoop()` function and replace it with a call to `runConversationLoop()` from `conversation-loop.js`. The new inbound path: (1) pre-answer allowFrom check (preserved from Story 3.1/3.2), (2) `mediaServer.connectCaller()`, (3) `dialog.on('destroy')` for endpoint destruction, (4) `runConversationLoop()` with all required options, (5) `dialog.destroy()` after loop returns (graceful goodbye). `runConversationLoop` handles `callActive` tracking via `dialog.on('destroy')`, DTMF cleanup, audio fork stop, `cancelExpectation`, and `endSession` in its `finally` block.
- Tasks 2-4: Verified teardown completeness in `conversation-loop.js` `finally` block (forkAudioStop, DTMF off, cancelExpectation, endSession) and plugin independence (session-store only removes Map entry, no agent workspace touched).
- Task 5: Added 4 new voice-app tests (`voice-app/test/session-lifecycle.test.js`) covering endSession called in finally, endSession called on fork failure, endSession non-throwing, and new callId per call. Added 2 new plugin tests in `webhook.test.js` covering end-session independence (queryAgent not called) and new call after hangup creates fresh session mapping. All 237 tests pass (107 CLI + 43 voice-app + 87 plugin). Lint: 0 errors.

### File List

- `voice-app/lib/sip-handler.js` (modified — removed inline conversationLoop, added runConversationLoop delegation)
- `voice-app/test/session-lifecycle.test.js` (new — session lifecycle tests)
- `openclaw-plugin/test/webhook.test.js` (modified — added 2 session lifecycle tests)
- `_bmad-output/implementation-artifacts/4-1-independent-session-lifecycle.md` (modified — story updates)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status in-progress → review)

## Change Log

- Date: 2026-02-25 — Refactored `sip-handler.js` inbound path to delegate to `runConversationLoop()`, removing 170-line duplicated inline loop. Inbound calls now have identical hangup detection, cleanup, and session teardown as outbound calls. Added 6 new tests covering session lifecycle (endSession in finally, session independence, new call after hangup). 237 total tests pass.

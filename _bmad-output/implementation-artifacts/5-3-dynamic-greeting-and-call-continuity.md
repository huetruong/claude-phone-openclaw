# Story 5.3: Dynamic Greeting & Call Continuity

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a caller,
I want the agent to greet me personally and pick up our last conversation,
So that every call feels like a continuation of an ongoing relationship rather than starting from scratch.

## Acceptance Criteria

1. **Given** an inbound call arrives and the call is answered
   **When** `runConversationLoop()` starts with `skipGreeting: false`
   **Then** hold music starts immediately and an initial bridge query is sent with caller identity context (`{ isFirstCall, identity, peerId }`)

2. **Given** the initial bridge query is sent
   **When** the agent responds with a greeting
   **Then** hold music stops (`uuid_break`) and the TTS-rendered greeting plays to the caller

3. **Given** the caller is known (present in `session.identityLinks`) and has prior conversation history
   **When** the agent generates the greeting
   **Then** the agent addresses the caller by their canonical name and references relevant context from the last conversation if appropriate

4. **Given** the caller is unknown (not in `session.identityLinks`)
   **When** the agent generates the greeting
   **Then** the agent introduces itself and begins enrollment (Story 5.2 `link_identity` flow activates naturally via agent behavior)

5. **Given** the initial bridge query fails (connection error, timeout, or HTTP 503)
   **When** the error is detected
   **Then** the voice-app falls back to a configurable static greeting (`FALLBACK_GREETING` env var, default `"Hello! How can I help you?"`) and continues the call normally — no call dropped

6. **Given** outbound calls with `skipGreeting: true`
   **When** `runConversationLoop()` starts
   **Then** behavior is unchanged — no initial query, `initialContext` prime used instead (brownfield preserved)

## Tasks / Subtasks

- [x] Task 1: Build initial query helper function (AC: #1, #3, #4)
  - [x] 1.1 Create `buildInitialQuery()` function in `conversation-loop.js` — **note:** implemented with no parameters (not `{ peerId, isFirstCall, identity }` as originally spec'd); identity context is provided entirely by the plugin layer (Story 5.2), not by this function
  - [x] 1.2 Function returns a prompt string that tells the agent: "You are answering an inbound call. Greet the caller." with a `[INITIAL GREETING REQUEST]:` marker
  - [x] 1.3 Known-caller context (`[CALLER CONTEXT: Known caller, identity="..."]`) is prepended by the plugin's `webhook-server.js` (Story 5.2) — **not implemented inside `buildInitialQuery`**; the initial query flows through the same `claudeBridge.query()` → `POST /voice/query` path as every other query, so identity prepending is automatic
  - [x] 1.4 Unknown-caller context (`[CALLER CONTEXT: First-time caller, no identity on file]`) is likewise handled by the plugin — **not implemented inside `buildInitialQuery`**
  - [x] 1.5 Include a directive for the agent to generate a natural greeting (NOT to repeat the context prefix)

- [x] Task 2: Replace hardcoded greeting with initial bridge query (AC: #1, #2, #5)
  - [x] 2.1 In `conversation-loop.js` lines 204-210, replace the hardcoded `"Hello! I'm your server..."` block
  - [x] 2.2 Start hold music immediately with existing `loopHoldMusic()` pattern (set `musicPlaying = true`, call `loopHoldMusic()`)
  - [x] 2.3 Create AbortController and wire to `dialog.on('destroy')` for hangup-during-greeting
  - [x] 2.4 Call `claudeBridge.query(initialQuery, { callId, accountId, peerId, signal })` — BLOCKING (wait for response)
  - [x] 2.5 Stop hold music: set `musicPlaying = false`, call `endpoint.api('uuid_break', endpoint.uuid)`
  - [x] 2.6 If `result.isError === false`: TTS-render `result.response` and play to caller
  - [x] 2.7 If `result.isError === true`: TTS-render `FALLBACK_GREETING` env var (default `"Hello! How can I help you?"`) and play

- [x] Task 3: Wire identity context from bridge to initial query (AC: #1, #3, #4)
  - [x] 3.1 The bridge's `query()` already forwards `peerId` to the plugin
  - [x] 3.2 The plugin (Story 5.2) already resolves identity and prepends `[CALLER CONTEXT: ...]` to the prompt
  - [x] 3.3 Verify the initial query flows through the same path — no special handling needed in the bridge
  - [x] 3.4 The initial query prompt combined with the plugin's identity context prefix gives the agent everything it needs

- [x] Task 4: Add FALLBACK_GREETING env var support (AC: #5)
  - [x] 4.1 Read `process.env.FALLBACK_GREETING` at module top level (same pattern as other env vars in conversation-loop.js)
  - [x] 4.2 Default value: `"Hello! How can I help you?"`
  - [x] 4.3 Add to `.env.example` with documentation comment
  - [x] 4.4 Add to CLAUDE.md Environment Variables table

- [x] Task 5: Handle edge cases (AC: #1, #5, #6)
  - [x] 5.1 Caller hangup during greeting query — AbortController aborts the bridge query; `callActive` check prevents TTS play
  - [x] 5.2 Caller hangup during greeting TTS — `callActive` check before `endpoint.play()`
  - [x] 5.3 `skipGreeting: true` (outbound) — entire initial query block is skipped, existing `initialContext` prime unchanged
  - [x] 5.4 Bridge returns empty response — treat as error, use fallback greeting

- [x] Task 6: Write tests (AC: #1, #2, #5, #6)
  - [x] 6.1 Test: dynamic greeting — successful bridge query, hold music plays during query, greeting TTS-rendered
  - [x] 6.2 Test: fallback greeting — bridge error triggers FALLBACK_GREETING
  - [x] 6.3 Test: fallback greeting — bridge returns `isError: true` triggers fallback
  - [x] 6.4 Test: skipGreeting true — no initial query sent
  - [x] 6.5 Test: hangup during greeting query — AbortController fires, no TTS play
  - [x] 6.6 Test: FALLBACK_GREETING env var — custom value used when set
  - [x] 6.7 Verify all existing 354 tests still pass (367 pass: 107 CLI + 124 voice-app + 136 plugin)

## Dev Notes

### Design Context

**FR34 (Dynamic Greeting):** Replace the hardcoded `"Hello! I'm your server. How can I help you today?"` in `conversation-loop.js` (line 206) with an initial bridge query. The agent controls its own greeting — it can personalize, reference history, or start enrollment.

**FR35 (Call Continuity):** The agent already has conversation history via OpenClaw's session persistence. The initial query just gives the agent the caller's identity context so it knows WHO is calling and can reference past conversations. No new session storage or history retrieval is needed — OpenClaw handles this automatically.

**Key insight:** This story is ~90% voice-app side (`conversation-loop.js`). The plugin already does identity resolution (Story 5.2). The bridge already sends `peerId`. The only new voice-app work is replacing the hardcoded greeting block with a bridge query + hold music + fallback.

### What Already Exists (DO NOT Recreate)

- `voice-app/lib/conversation-loop.js` — Core conversation loop with:
  - `loopHoldMusic()` pattern (lines 398-407) — reuse this exact pattern for greeting
  - `uuid_break` stop mechanism (lines 432-436) — reuse for stopping greeting hold music
  - `AbortController` pattern (lines 390-392) — reuse for hangup-during-greeting abort
  - `skipGreeting` flag (line 204) — already checked; just expand the block
  - `callActive` flag (line 180) — already tracked; use for all guard checks
- `voice-app/lib/openclaw-bridge.js` — Bridge `query()` already accepts `{ callId, accountId, peerId, signal }` options
- `openclaw-plugin/src/identity.js` — `resolveIdentity()` already detects first-time vs known callers (Story 5.2)
- `openclaw-plugin/src/webhook-server.js` — Already prepends `[CALLER CONTEXT: ...]` to prompts (Story 5.2)
- `openclaw-plugin/src/index.js` — Already passes identity context through `queryAgent` (Story 5.2)

### What You Are Building

1. **MODIFY: `voice-app/lib/conversation-loop.js`** — Replace lines 204-210 (hardcoded greeting) with dynamic greeting block:
   - `buildInitialQuery()` helper function
   - Hold music during initial query
   - Fallback greeting on error
   - `FALLBACK_GREETING` env var
2. **MODIFY: `.env.example`** — Add `FALLBACK_GREETING` variable
3. **MODIFY: `CLAUDE.md`** — Add `FALLBACK_GREETING` to Environment Variables table
4. **NEW tests** — Dynamic greeting tests in voice-app test suite

### Critical Implementation Rules

- **CommonJS only** — `module.exports`, `require()`, no `import` statements
- **Reuse existing patterns** — loopHoldMusic, uuid_break, AbortController, callActive checks are all proven; copy the pattern from the main conversation loop (lines 390-436)
- **Hold music MUST start before the bridge query** — user hears music immediately, not silence
- **AbortController for greeting query** — if caller hangs up during greeting generation, abort the bridge query (same pattern as main loop)
- **Fallback greeting is TTS-rendered** — not a raw audio file; it goes through the same `ttsService.generateSpeech()` path
- **No plugin changes** — Story 5.2 already handles identity resolution and context prepending
- **No bridge changes** — `openclaw-bridge.js` already supports all needed options
- **Logger discipline** — use existing `logger` instance; phone numbers at DEBUG only

### Implementation Reference: Greeting Replacement Block

Replace lines 204-210 in `conversation-loop.js`:

```js
// CURRENT (lines 204-210):
if (!skipGreeting && callActive) {
  const greetingUrl = await ttsService.generateSpeech(
    "Hello! I'm your server. How can I help you today?",
    voiceId
  );
  await endpoint.play(greetingUrl);
}
```

With (architecture reference):

```js
// NEW: Dynamic greeting via initial bridge query
if (!skipGreeting && callActive) {
  // Build initial query with identity context
  const initialQuery = buildInitialQuery({ peerId });

  // Hold music while agent generates greeting
  let greetingMusicPlaying = true;
  const loopGreetingMusic = () => {
    if (!greetingMusicPlaying || !callActive) return;
    endpoint.play(HOLD_MUSIC_URL)
      .then(() => setImmediate(loopGreetingMusic))
      .catch((e) => { logger.warn('Greeting hold music error', { callUuid, error: e.message }); });
  };
  loopGreetingMusic();

  // AbortController for hangup-during-greeting
  const greetingController = new AbortController();
  const onGreetingDestroy = () => greetingController.abort();
  dialog.on('destroy', onGreetingDestroy);

  let greetingText;
  try {
    const result = await claudeBridge.query(initialQuery, {
      callId: callUuid,
      devicePrompt,
      accountId: deviceConfig?.accountId,
      peerId,
      signal: greetingController.signal
    });

    if (!result.isError && result.response) {
      greetingText = result.response;
    } else {
      greetingText = FALLBACK_GREETING;
    }
  } catch (err) {
    if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError') {
      greetingMusicPlaying = false;
      dialog.off('destroy', onGreetingDestroy);
      return; // Caller hung up during greeting — exit cleanly
    }
    logger.warn('Initial greeting query failed', { callUuid, error: err.message });
    greetingText = FALLBACK_GREETING;
  }

  // Stop hold music
  greetingMusicPlaying = false;
  dialog.off('destroy', onGreetingDestroy);
  if (callActive) {
    await endpoint.api('uuid_break', endpoint.uuid).catch(() => {});
  }

  // Play greeting via TTS
  if (callActive) {
    const greetingUrl = await ttsService.generateSpeech(greetingText, voiceId);
    if (callActive) await endpoint.play(greetingUrl);
  }
}
```

### buildInitialQuery Helper

```js
const FALLBACK_GREETING = process.env.FALLBACK_GREETING || 'Hello! How can I help you?';

function buildInitialQuery({ peerId }) {
  // The plugin (Story 5.2) will prepend [CALLER CONTEXT: ...] with identity info.
  // This query just tells the agent to generate a greeting.
  return '[INITIAL GREETING REQUEST]: You are answering an inbound phone call. Generate a natural, friendly greeting for the caller. If you know who they are, greet them by name and briefly reference your last conversation if relevant. If this is a first-time caller, introduce yourself warmly. Keep it concise — this is a voice greeting, not a text response.';
}
```

**Important:** The `buildInitialQuery` does NOT need to include identity context in the prompt. The plugin's webhook handler (Story 5.2) already prepends `[CALLER CONTEXT: Known caller, identity="hue"]` or `[CALLER CONTEXT: First-time caller, no identity on file]` to EVERY query. The initial greeting query goes through the same `claudeBridge.query()` → `POST /voice/query` → plugin path as every other query.

### Variable Declarations

Add near the top of `conversation-loop.js` with other constants (around line 20):

```js
const FALLBACK_GREETING = process.env.FALLBACK_GREETING || 'Hello! How can I help you?';
```

### Env Var Documentation

Add to `.env.example`:
```bash
# Fallback greeting when dynamic greeting query fails (voice-app)
# FALLBACK_GREETING="Hello! How can I help you?"
```

Add to `CLAUDE.md` Environment Variables table:
```
| `FALLBACK_GREETING` | voice-app | Static greeting fallback if agent query fails |
```

### Testing Standards

- **Framework**: Node.js built-in `node:test` runner
- **Existing voice-app tests**: 111 in `voice-app/test/` — examine `hold-music-unavailability.test.js` for hold music mocking patterns
- **Key mocks needed**: `claudeBridge.query`, `ttsService.generateSpeech`, `endpoint.play`, `endpoint.api`, `dialog.on/off`
- **Total existing test count**: 354 (107 CLI + 111 voice-app + 136 plugin) — must not break any
- **Test file**: `voice-app/test/dynamic-greeting.test.js` (new)

### Previous Story Learnings (from Story 5.2)

1. **Handler factory pattern** — Story 5.2 used `createLinkIdentityHandler()` factory for testability. Consider if `buildInitialQuery` needs similar treatment (probably not — it's a pure function, easily testable directly).
2. **Promise-chain mutex** — Story 5.2's enrollment mutex uses `.then(fn, fn)` pattern. Not relevant here but shows the project's async convention.
3. **Prompt injection format** — Story 5.2 uses `[CALLER CONTEXT: Known caller, identity="hue"]` prefix. The initial greeting request should use a similar bracket-prefix format for consistency: `[INITIAL GREETING REQUEST]: ...`.
4. **No `axios` in plugin** — Plugin uses Node.js built-in HTTP. But voice-app uses `axios` (see `openclaw-bridge.js` line 9). No new dependencies needed.
5. **`api.config`** — Confirmed as the config reference in Story 5.2. Identity resolution already works end-to-end.
6. **Test count went to 354** (349 + 5 from code review fixes in Story 5.2).

### Git Intelligence

Recent commits:
- `2596231 feat(story-5-2): dynamic identity enrollment via link_identity tool (#25)` — identity resolution works end-to-end
- `b53259a feat(story-5-1): plugin-triggered outbound calls (#24)` — outbound client, `placeCall` exposed
- `be33596 feat(story-4-3): hold music loop, unavailability message, pre-call check (#20)` — hold music pattern established

The hold music and unavailability message patterns from Story 4.3 are directly reusable. The greeting replacement follows the exact same `loopHoldMusic → query → uuid_break → TTS play` flow that the main conversation turn already uses.

### What This Story Does NOT Include

- **Plugin changes** — Story 5.2 already handles identity resolution; no plugin modifications
- **Bridge changes** — `openclaw-bridge.js` already supports all needed options
- **`place_call` tool** — Story 5.4 scope
- **SKILL.md** — Story 5.4 scope
- **Outbound identity resolution** — Story 5.5 scope
- **Cross-channel response delivery** — Story 5.6 scope
- **Agent prompt/personality configuration** — The agent's actual greeting words come from OpenClaw agent configuration, not this story

### Project Structure Notes

- Modified: `voice-app/lib/conversation-loop.js` — Replace hardcoded greeting with dynamic greeting block
- Modified: `.env.example` — Add `FALLBACK_GREETING`
- Modified: `CLAUDE.md` — Add `FALLBACK_GREETING` to env var table
- New test: `voice-app/test/dynamic-greeting.test.js`
- No new dependencies required
- No plugin files modified

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.3] — Story definition and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Dynamic-Greeting-Pattern] — Architecture spec with code examples (lines 266-296)
- [Source: _bmad-output/planning-artifacts/prd.md#FR34] — Dynamic greeting requirement
- [Source: _bmad-output/planning-artifacts/prd.md#FR35] — Call continuity requirement
- [Source: voice-app/lib/conversation-loop.js#L204-L210] — Current hardcoded greeting (replace target)
- [Source: voice-app/lib/conversation-loop.js#L398-L436] — Hold music loop pattern (reuse)
- [Source: voice-app/lib/conversation-loop.js#L390-L392] — AbortController pattern (reuse)
- [Source: voice-app/lib/openclaw-bridge.js] — Bridge query interface (unchanged)
- [Source: openclaw-plugin/src/webhook-server.js] — Identity context already prepended to queries (Story 5.2)
- [Source: _bmad-output/implementation-artifacts/5-2-dynamic-identity-enrollment.md] — Previous story learnings

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Fixed test hang in `hold-music-unavailability.test.js`: tests were missing `skipGreeting: true`, causing new greeting block to hit never-resolving bridge mock in the hold-music loop test. Added `skipGreeting: true` to all `runConversationLoop` calls in that file.
- Fixed vacuous-pass bug in `abort-on-hangup.test.js`: same root cause. Without `skipGreeting: true`, the mock bridge's `triggerHangup()` fired during the **greeting** query (not the main-loop query), causing `calls.queryAborted = true` to be set for the wrong code path — tests passed but validated no meaningful behaviour. Added `skipGreeting: true` to all `runConversationLoop` calls in the conversation-loop abort suite so the abort correctly happens inside the main turn loop as intended.

### Completion Notes List

- Replaced hardcoded `"Hello! I'm your server..."` greeting with dynamic initial bridge query in `conversation-loop.js`
- Added `buildInitialQuery()` helper — returns `[INITIAL GREETING REQUEST]: ...` prompt; plugin prepends `[CALLER CONTEXT: ...]` automatically via Story 5.2
- Hold music plays immediately during greeting query (same `loopHoldMusic` pattern as main turn)
- `AbortController` wired to `dialog.on('destroy')` — caller hangup during greeting aborts query and exits cleanly
- `FALLBACK_GREETING` env var added (default `"Hello! How can I help you?"`) used when bridge errors or returns empty
- `skipGreeting: true` (outbound calls) skips greeting block entirely — no change to outbound behavior
- 15 new tests in `voice-app/test/dynamic-greeting.test.js` covering all AC scenarios plus peerId forwarding (2 added in code review)
- Total test count: 369 (107 CLI + 126 voice-app + 136 plugin), all passing

### File List

- `voice-app/lib/conversation-loop.js` — replaced hardcoded greeting with dynamic greeting block; added `buildInitialQuery()` and `FALLBACK_GREETING` constant
- `voice-app/test/dynamic-greeting.test.js` — new: 15 tests for Story 5.3 (includes peerId-forwarding tests added in code review)
- `voice-app/test/hold-music-unavailability.test.js` — added `skipGreeting: true` to all `runConversationLoop` calls (test fix, see Debug Log)
- `voice-app/test/abort-on-hangup.test.js` — added `skipGreeting: true` to all `runConversationLoop` calls in the conversation-loop abort suite (same test fix, see Debug Log)
- `.env.example` — added `FALLBACK_GREETING` variable with comment
- `CLAUDE.md` — added `FALLBACK_GREETING` to Environment Variables table
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated to `review`

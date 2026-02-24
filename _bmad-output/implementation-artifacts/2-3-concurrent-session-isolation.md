# Story 2.3: Concurrent Session Isolation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a caller,
I want my call to be fully isolated from other callers on the same extension,
so that two simultaneous calls to extension 9000 never share context.

## Acceptance Criteria

1. **Given** two callers dial extension 9000 simultaneously, each receiving a unique `callId` from drachtio
   **When** both calls send `POST /voice/query` to the plugin
   **Then** the session store creates two separate `callId` → `sessionId` mappings and each query is routed to an independent OpenClaw session

2. **Given** caller A and caller B both have active sessions on extension 9000
   **When** caller A sends a message referencing prior conversation context
   **Then** caller A's response reflects only caller A's session history, with no data from caller B's session

3. **Given** caller A hangs up while caller B is still on the line
   **When** `POST /voice/end-session` is sent for caller A's `callId`
   **Then** only caller A's session mapping is removed; caller B's session continues unaffected

4. **Given** the multi-registrar (`multi-registrar.js`) registers extensions 9000 and 9002 with the PBX
   **When** a network interruption occurs and recovers
   **Then** both registrations re-establish automatically without manual intervention (FR3 brownfield verified)

## Tasks / Subtasks

- [x] Task 1: Write concurrent session isolation test — two callers get separate session entries (AC: #1)
  - [x] Add test `'webhook - concurrent calls on same extension get separate session store entries'` to `openclaw-plugin/test/webhook.test.js`
  - [x] Use `Promise.all` to fire two simultaneous `/voice/query` requests with `callId: 'call-A'` and `callId: 'call-B'`
  - [x] Assert `sessionStore.get('call-A')` and `sessionStore.get('call-B')` both exist
  - [x] Assert they are NOT equal (different sessionIds)
  - [x] Assert `sessionStore.size() === 2`

- [x] Task 2: Write independent OpenClaw session routing test (AC: #2)
  - [x] Add test `'webhook - concurrent callers on same extension route to independent OpenClaw sessions'` to `webhook.test.js`
  - [x] Capture `queryAgent` calls; use `Promise.all` with `callId: 'concurrent-A'` and `callId: 'concurrent-B'`
  - [x] Assert `calls.length === 2` and `calls[0].sessionId !== calls[1].sessionId`
  - [x] Assert each response body reflects that caller's own sessionId (no cross-contamination)

- [x] Task 3: Write selective end-session isolation test (AC: #3)
  - [x] Add test `'webhook - end-session for caller A does not affect caller B session'` to `webhook.test.js`
  - [x] Establish two sessions via sequential queries for `caller-A` and `caller-B`
  - [x] Send `POST /voice/end-session` for `caller-A`
  - [x] Assert `sessionStore.get('caller-A') === undefined` (removed)
  - [x] Assert `sessionStore.get('caller-B')` still exists (unaffected)
  - [x] Assert `sessionStore.size() === 1`

- [x] Task 4: Verify AC #4 brownfield (no code change needed)
  - [x] Confirm `voice-app/lib/multi-registrar.js` exists and handles SIP re-registration — it does (pre-existing brownfield code)
  - [x] No new test or code needed — AC 4 is a brownfield requirement already satisfied by `multi-registrar.js`
  - [x] Document as confirmed in Dev Notes below

## Dev Notes

### CRITICAL: No Production Code Changes Needed

**ACs 1, 2, and 3 are ALREADY IMPLEMENTED by existing code from Stories 1.2 and 1.3.**

**Why isolation is already guaranteed:**

1. **`session-store.js`** (line 7): uses an in-memory `Map` keyed by `callId` — `store.set(callId, sessionId)`. Two calls with different `callId`s create two distinct Map entries. JavaScript's `Map` handles concurrent access safely in a single-threaded event loop.

2. **`webhook-server.js`** (lines 69–73): Session creation uses `callId` as the lookup key AND as the `sessionId` value:
   ```js
   let sessionId = sessionStore.get(callId);
   if (!sessionId) {
     sessionId = callId; // callId IS the sessionId
     sessionStore.create(callId, sessionId);
   }
   ```
   Since drachtio assigns each call a unique UUID v4 `callId`, each concurrent call gets a distinct `sessionId`. Context bleed is structurally impossible.

3. **`webhook-server.js`** (lines 93–98): `end-session` calls `sessionStore.remove(callId)` which is `store.delete(callId)` — removes only the specified key, leaving all other entries intact.

This story's **only deliverable is tests** that explicitly prove this isolation holds under concurrent conditions.

[Source: openclaw-plugin/src/session-store.js:7-29]
[Source: openclaw-plugin/src/webhook-server.js:69-98]

### AC 4: Multi-Registrar Brownfield

`voice-app/lib/multi-registrar.js` is pre-existing brownfield code that handles SIP re-registration automatically on network interruption. This was built into the base codebase and is not modified by this story. No test needed — this is an integration-level behavior that would require a live SIP environment to validate.

> **Automation gap (permanent):** AC#4 cannot be covered by the automated test suite. Verifying SIP re-registration requires a live drachtio + FreeSWITCH environment with a simulated network interruption. This gap is accepted per story scope.

[Source: CLAUDE.md#Architecture — multi-registrar.js]
[Source: epics.md#FR3 — Multi-extension SIP registration (brownfield)]

### Exact Tests to Add in `webhook.test.js`

Add these 3 tests after the existing `// ── POST /voice/query — session management` block (after line 222).

**Test 1 — AC 1: Two concurrent calls get separate session entries:**
```js
test('webhook - concurrent calls on same extension get separate session store entries', async () => {
  await withServer(makeConfig(), async (server) => {
    const sessionStore = require('../src/session-store');

    // Two callers dial simultaneously — fired concurrently with Promise.all.
    await Promise.all([
      request(server, { path: '/voice/query', method: 'POST', headers: AUTH },
        { prompt: 'hello from A', callId: 'call-A', accountId: 'morpheus', peerId: '+15551111111' }),
      request(server, { path: '/voice/query', method: 'POST', headers: AUTH },
        { prompt: 'hello from B', callId: 'call-B', accountId: 'morpheus', peerId: '+15552222222' })
    ]);

    assert.ok(sessionStore.get('call-A'), 'Caller A session must exist');
    assert.ok(sessionStore.get('call-B'), 'Caller B session must exist');
    assert.notStrictEqual(
      sessionStore.get('call-A'),
      sessionStore.get('call-B'),
      'Caller A and B must have different sessionIds — no context sharing'
    );
    assert.strictEqual(sessionStore.size(), 2, 'Exactly two independent sessions must be active');
  });
});
```

**Test 2 — AC 2: Concurrent sessions route to independent OpenClaw sessions:**
```js
test('webhook - concurrent callers on same extension route to independent OpenClaw sessions', async () => {
  const calls = [];
  const queryAgent = async (agentId, sessionId, prompt) => {
    calls.push({ agentId, sessionId, prompt });
    return `reply for session ${sessionId}`;
  };
  await withServer(makeConfig({ queryAgent }), async (server) => {
    const [resA, resB] = await Promise.all([
      request(server, { path: '/voice/query', method: 'POST', headers: AUTH },
        { prompt: 'caller A prompt', callId: 'concurrent-A', accountId: 'morpheus', peerId: '+1' }),
      request(server, { path: '/voice/query', method: 'POST', headers: AUTH },
        { prompt: 'caller B prompt', callId: 'concurrent-B', accountId: 'morpheus', peerId: '+2' })
    ]);

    assert.strictEqual(calls.length, 2, 'queryAgent must be called once per caller');
    assert.notStrictEqual(
      calls[0].sessionId,
      calls[1].sessionId,
      'Each concurrent caller must receive an independent sessionId'
    );
    // Each response reflects only that caller's own session.
    assert.ok(
      resA.body.response.includes('concurrent-A'),
      'Caller A response must reference only caller A session'
    );
    assert.ok(
      resB.body.response.includes('concurrent-B'),
      'Caller B response must reference only caller B session'
    );
  });
});
```

**Test 3 — AC 3: end-session for caller A leaves caller B unaffected:**
```js
test('webhook - end-session for caller A does not affect caller B session', async () => {
  await withServer(makeConfig(), async (server) => {
    const sessionStore = require('../src/session-store');

    // Establish two sessions.
    await request(server, { path: '/voice/query', method: 'POST', headers: AUTH },
      { prompt: 'hi', callId: 'caller-A', accountId: 'morpheus', peerId: '+1' });
    await request(server, { path: '/voice/query', method: 'POST', headers: AUTH },
      { prompt: 'hi', callId: 'caller-B', accountId: 'morpheus', peerId: '+2' });

    assert.strictEqual(sessionStore.size(), 2, 'Two sessions must be active before end-session');

    // Caller A hangs up.
    const res = await request(server, { path: '/voice/end-session', method: 'POST', headers: AUTH },
      { callId: 'caller-A' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });

    // Only caller A removed; caller B unaffected.
    assert.strictEqual(sessionStore.get('caller-A'), undefined, 'Caller A session must be removed');
    assert.ok(sessionStore.get('caller-B'), 'Caller B session must remain active');
    assert.strictEqual(sessionStore.size(), 1, 'Exactly one session must remain after caller A ends');
  });
});
```

[Source: openclaw-plugin/test/webhook.test.js:184–222 — existing session management tests to add after]

### Placement in webhook.test.js

Add the 3 new tests **after line 222** (end of the `// ── POST /voice/query — session management` block), before `// ── POST /voice/query — validation errors`.

The `beforeEach` at line 83 already calls `sessionStore.clear()` — this ensures each test starts with a clean session store.

### Previous Story Intelligence (2.2)

- **Test isolation is already handled**: `beforeEach` clears the session store before every test. The concurrent tests use unique callIds per test (`call-A`/`call-B`, `concurrent-A`/`concurrent-B`, `caller-A`/`caller-B`) — no conflicts.
- **`requireWebhookServer()` reloads all deps**: The `requireWebhookServer()` helper deletes `session-store` from require cache on each call. However, the concurrent tests use `withServer()` (not `requireWebhookServer()` directly), so they share a single module instance within each `withServer()` block — correct behavior for testing concurrent request handling.
- **No voice-app changes**: Story 2.3 is plugin-only (test-only at that). Do NOT touch `voice-app/`.
- **`Promise.all` tests**: Node.js test runner handles parallel requests correctly — Express routes are async and Node.js event loop processes them concurrently.

### Git Intelligence

- Recent commit pattern: `feat(story-X-Y): description` — follow this for the PR
- Branch: `feature/story-2-3-concurrent-session-isolation` (already created)
- Current test baseline: **209 tests total** (101 cli + 30 voice-app + 78 plugin)
- After this story: **212 tests total** (+3 plugin tests, no changes to cli or voice-app)

### Files to Create/Modify

```
openclaw-plugin/
└── test/
    └── webhook.test.js  ← MODIFIED (+3 concurrent isolation tests after line 222)
```

**No production code changes. No new files. No dependencies added. No voice-app changes.**

### Scope Boundaries — Do NOT Do These

- Do NOT modify `session-store.js` — it's already correct (Map keyed by callId)
- Do NOT modify `webhook-server.js` — it already creates independent sessions per callId
- Do NOT add Redis or session persistence — in-memory Map only (OpenClaw bug #3290 unchanged)
- Do NOT add thread-safety mechanisms — Node.js is single-threaded, the event loop handles this correctly
- Do NOT modify `multi-registrar.js` — brownfield, untouched
- Do NOT add `allowFrom` enforcement — that is Epic 3
- Do NOT touch `voice-app/` in any way

### Project Structure Notes

- All changes within `openclaw-plugin/test/` only
- No new test files needed — add 3 tests to the existing `webhook.test.js`
- `beforeEach` at line 83 already provides test isolation via `sessionStore.clear()`

### References

- [Source: epics.md#Story 2.3] — Acceptance criteria and user story
- [Source: architecture.md#Data Architecture] — In-memory Map, callId = drachtio UUID, no persistence
- [Source: architecture.md#Session Key Format] — callId = UUID v4, verbatim, never transformed
- [Source: openclaw-plugin/src/session-store.js] — Map implementation, `create`, `get`, `remove`, `clear`, `size`
- [Source: openclaw-plugin/src/webhook-server.js:69-73] — Session create-or-resume logic (callId IS sessionId)
- [Source: openclaw-plugin/src/webhook-server.js:93-98] — `remove(callId)` only removes the specified key
- [Source: openclaw-plugin/test/webhook.test.js:83-88] — `beforeEach` clears session store
- [Source: openclaw-plugin/test/webhook.test.js:184-222] — Existing session tests (placement reference)
- [Source: prd.md#FR4] — Concurrent isolated sessions

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

None — all tests passed on first run with no debugging needed.

### Completion Notes List

- Added 3 concurrent session isolation tests to `openclaw-plugin/test/webhook.test.js`
- Test 1 (AC #1): Verifies two simultaneous callers on the same extension get separate session store entries with different sessionIds
- Test 2 (AC #2): Verifies concurrent callers route to independent OpenClaw sessions with no cross-contamination in responses
- Test 3 (AC #3): Verifies end-session for caller A removes only caller A's session, leaving caller B unaffected
- AC #4 confirmed: `voice-app/lib/multi-registrar.js` exists and handles SIP re-registration (brownfield, no changes needed)
- No production code changes — isolation was already implemented in Stories 1.2 and 1.3; this story only adds proof via tests
- Full test suite: 212 tests (101 cli + 30 voice-app + 81 plugin), 0 failures, 0 regressions
- Lint: 0 errors (12 pre-existing warnings in voice-app brownfield code)

### Change Log

- 2026-02-23: Added 3 concurrent session isolation tests to webhook.test.js (Tasks 1-3), confirmed AC #4 brownfield (Task 4)
- 2026-02-23: Code review fixes applied — H1: capture Promise.all results + status assertions in Test 1; H2: status assertions for Test 3 setup requests; M1: fixed beforeEach isolation (requireWebhookServer no longer evicts session-store from cache); M2: added specific sessionId equality assertions alongside notStrictEqual in Test 1; M3: documented non-deterministic calls[] ordering in Test 2; L1: added automation gap note for AC#4 in Dev Notes; L2: fixed section comment trailing dashes

### File List

- `openclaw-plugin/test/webhook.test.js` — MODIFIED (+3 concurrent isolation tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (story status updated)
- `_bmad-output/implementation-artifacts/2-3-concurrent-session-isolation.md` — MODIFIED (task checkboxes, dev record)

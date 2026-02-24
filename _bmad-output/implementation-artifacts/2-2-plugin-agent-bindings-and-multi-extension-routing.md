# Story 2.2: Plugin Agent Bindings & Multi-Extension Routing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want to configure agent bindings in the plugin config so each extension routes to its specific agent,
so that calling 9000 always reaches Morpheus and 9002 always reaches Cephanie.

## Acceptance Criteria

1. **Given** the plugin config contains `accounts: [{ id: "morpheus", extension: "9000" }, { id: "cephanie", extension: "9002" }]` and `bindings: [{ accountId: "morpheus", agentId: "morpheus" }, { accountId: "cephanie", agentId: "cephanie" }]`
   **When** the plugin starts
   **Then** the plugin loads all account and binding entries and logs `[sip-voice] loaded 2 account bindings`

2. **Given** a `POST /voice/query` arrives with `"accountId": "morpheus"`
   **When** the plugin resolves the binding
   **Then** the query is routed to the OpenClaw agent with `agentId` "morpheus"

3. **Given** a `POST /voice/query` arrives with `"accountId": "cephanie"`
   **When** the plugin resolves the binding
   **Then** the query is routed to the OpenClaw agent with `agentId` "cephanie"

4. **Given** a `POST /voice/query` arrives with an `accountId` that has no configured binding
   **When** the plugin attempts to resolve the binding
   **Then** the plugin returns HTTP 404 with `{ "error": "no agent binding for accountId" }` and logs at WARN level

5. **Given** the plugin config includes a `configSchema` in `openclaw.plugin.json`
   **When** the operator installs the plugin via `openclaw plugins install -l ./openclaw-plugin` or `npm install openclaw-sip-voice`
   **Then** the plugin installs without errors and validates the config schema on startup

## Tasks / Subtasks

- [x] Task 1: Add `[sip-voice] loaded N account bindings` log line to `activate()` (AC: #1)
  - [x] In `openclaw-plugin/src/index.js`, after building the bindings/accounts arrays, add: `logger.info(\`loaded ${bindings.length} account bindings\`);`
  - [x] Place BEFORE the existing `logger.info('channel registered', ...)` call (startup sequence: load → register)
  - [x] Keep the existing `channel registered` log unchanged (Story 1.1 backward compat)

- [x] Task 2: Update `index.test.js` for the new log line (AC: #1)
  - [x] The existing test `'activate() must emit exactly one INFO log line'` asserts `logLines.length === 1` — this will FAIL after Task 1 adds a second log line
  - [x] Update that assertion from `=== 1` to `=== 2`
  - [x] Add a new test: `'index - activate() logs [sip-voice] loaded N account bindings'` that verifies the new log line exists and includes the binding count

- [x] Task 3: Add explicit cephanie routing test to `webhook.test.js` (AC: #2, #3)
  - [x] Add test: `'webhook - POST /voice/query routes cephanie accountId to cephanie agentId'`
  - [x] Mirror the existing morpheus `passes correct args` test but with `accountId: 'cephanie'`
  - [x] Assert `calls[0].agentId === 'cephanie'`

- [x] Task 4: Verify AC #4 and #5 are already satisfied (no code changes needed)
  - [x] AC 4: Confirm `webhook.test.js` test `'POST /voice/query unknown accountId returns 404'` already covers this — also added `logger.warn` for AC 4 WARN requirement
  - [x] AC 5: Confirm `openclaw.plugin.json` already has `configSchema` with `accounts`, `bindings`, `webhookPort`, `apiKey`
  - [x] Run `npm test` to confirm all existing tests still pass after Tasks 1–3

## Dev Notes

### CRITICAL: What's Already Done (Do NOT Reinvent)

**ACs 2, 3, and 4 are fully implemented in `webhook-server.js` from Story 1.3.**

The `bindingMap` is built and used in `webhook-server.js:26-61`:
```js
// Built in createServer() at lines 26-31
const bindingMap = new Map();
for (const b of (config.bindings || [])) {
  bindingMap.set(b.accountId, b.agentId);
}

// Used in POST /voice/query at lines 58-61
const agentId = bindingMap.get(accountId);
if (!agentId) {
  return res.status(404).json({ error: 'no agent binding for accountId' });
}
```

The 404 body `{ error: 'no agent binding for accountId' }` matches AC 4 **exactly**. WARN log for unknown accountId is NOT currently in webhook-server.js — the 404 is returned silently. Check if AC 4 "logs at WARN level" needs a logger.warn call added. Looking at the current code: no `logger.warn` for unknown binding. This may be a minor gap — add `logger.warn('no agent binding for accountId', { accountId })` before the 404 return if needed.

**AC 5 is fully satisfied** — `openclaw.plugin.json` already contains:
```json
"configSchema": {
  "webhookPort": { "type": "number", "default": 3334 },
  "apiKey": { "type": "string" },
  "accounts": { "type": "array", "items": { "type": "object" } },
  "bindings": { "type": "array", "items": { "type": "object" } },
  "identityLinks": { "type": "object" }
}
```

[Source: openclaw-plugin/openclaw.plugin.json]
[Source: openclaw-plugin/src/webhook-server.js:26-61 — binding map and 404]

### Task 1: Exact Code Change for index.js

**Current `activate()` in `openclaw-plugin/src/index.js` lines 21-27:**
```js
const accounts = pluginConfig.accounts || [];
const bindings = pluginConfig.bindings || [];
logger.info('channel registered', {
  accounts: accounts.length,
  bindings: bindings.length
});
```

**Change to:**
```js
const accounts = pluginConfig.accounts || [];
const bindings = pluginConfig.bindings || [];
logger.info(`loaded ${bindings.length} account bindings`);
logger.info('channel registered', {
  accounts: accounts.length,
  bindings: bindings.length
});
```

This adds ONE line. The existing `channel registered` log is preserved unchanged.

[Source: openclaw-plugin/src/index.js:21-27]

### Task 2: Exact Test Changes for index.test.js

**Test to update — currently at line 109:**
```js
// BEFORE (will fail after Task 1):
assert.strictEqual(logLines.length, 1, 'activate() must emit exactly one INFO log line');

// AFTER:
assert.strictEqual(logLines.length, 2, 'activate() must emit exactly two INFO log lines');
```

**New test to add (after the existing "logs [sip-voice] channel registered" test):**
```js
test('index - activate() logs [sip-voice] loaded N account bindings', async () => {
  const plugin = requireIndex();
  const api = createMockApi({
    accounts: [{ id: 'morpheus' }, { id: 'cephanie' }],
    bindings: [
      { accountId: 'morpheus', agentId: 'morpheus' },
      { accountId: 'cephanie', agentId: 'cephanie' }
    ]
  });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    await plugin.activate(api);
  } finally {
    console.log = origLog;
  }

  const bindingsLog = logLines.find((line) => line.includes('loaded') && line.includes('account bindings'));
  assert.ok(bindingsLog, 'activate() must log "loaded N account bindings"');
  assert.ok(bindingsLog.includes('[sip-voice]'), 'Log must include [sip-voice] prefix');
  assert.ok(bindingsLog.includes('2'), 'Log must include binding count (2)');
});
```

**IMPORTANT**: The existing test at line 116–133 (`'activate() includes account and binding counts in log'`) captures `logLines[0]` and checks for `'"accounts":2'`. After Task 1, `logLines[0]` will be the NEW bindings log and `logLines[1]` will be `channel registered`. Update that test's index from `[0]` to `[1]`:
```js
// BEFORE:
assert.ok(logLines[0].includes('"accounts":2'), ...);
assert.ok(logLines[0].includes('"bindings":1'), ...);

// AFTER:
assert.ok(logLines[1].includes('"accounts":2'), ...);
assert.ok(logLines[1].includes('"bindings":1'), ...);
```

[Source: openclaw-plugin/test/index.test.js:96-133 — tests to update]

### Task 3: Exact Test to Add to webhook.test.js

Add after the existing `'POST /voice/query passes correct args to queryAgent'` test:

```js
test('webhook - POST /voice/query routes cephanie accountId to cephanie agentId', async () => {
  const calls = [];
  const queryAgent = async (agentId, sessionId, prompt, peerId) => {
    calls.push({ agentId, sessionId, prompt, peerId });
    return 'hello from Cephanie';
  };
  await withServer(makeConfig({ queryAgent }), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'test prompt', callId: 'call-cephanie', accountId: 'cephanie', peerId: '+15559999999' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { response: 'hello from Cephanie' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].agentId, 'cephanie', 'cephanie accountId must route to cephanie agentId');
  });
});
```

[Source: openclaw-plugin/test/webhook.test.js:150-165 — existing morpheus test to mirror]

### AC 4 WARN Logging Gap

The current `webhook-server.js` returns HTTP 404 for unknown `accountId` but does NOT log at WARN level (no `logger.warn` call). AC 4 says "logs at WARN level". Add to `webhook-server.js` before the 404 return:

```js
const agentId = bindingMap.get(accountId);
if (!agentId) {
  logger.warn('no agent binding for accountId', { accountId });  // ← ADD THIS LINE
  return res.status(404).json({ error: 'no agent binding for accountId' });
}
```

This is a MINOR addition. Note: `accountId` is safe to log at WARN (it's not a phone number/PII). The caller's phone number (`peerId`) is the only PII — `accountId` is an operator-configured string like "morpheus".

[Source: openclaw-plugin/src/webhook-server.js:58-61]

### Previous Story Intelligence (2.1)

- **Test fs mock isolation**: When patching `fs.existsSync`/`fs.readFileSync`, intercept only calls where the path matches the config path — pass all others to original. (Relevant if any new file I/O is added, which it isn't here.)
- **Conversation-loop mock**: `mockDialog` needs both `on()` and `off()`. Not relevant to this story (plugin-only changes).
- **No bridge changes needed**: Story 2.2 is entirely within `openclaw-plugin/`. Do NOT touch `voice-app/`.

### Git Intelligence

Recent commit pattern: `feat(story-X-Y): description` for feature commits, `fix(story-X-Y): description` for fixes.
Branch naming: `feature/story-X-Y-slug`. Current branch: `feature/story-2-2-plugin-agent-bindings-and-multi-extension-routing`.

74 tests currently pass (from `npm test`). After implementing this story, expect **77 tests** (74 existing + 2 new: cephanie routing test + loaded bindings log test, minus the expectation change).

### Files to Create/Modify

```
openclaw-plugin/
├── src/
│   ├── index.js           ← MODIFIED (+1 log line)
│   └── webhook-server.js  ← MODIFIED (+1 logger.warn line for AC 4)
└── test/
    ├── index.test.js      ← MODIFIED (update log count assertions, add 1 test)
    └── webhook.test.js    ← MODIFIED (add 1 cephanie routing test)
```

No new files. No new dependencies. No voice-app changes.

[Source: architecture.md#Complete Project Directory Structure]
[Source: CLAUDE.md#Directory Structure]

### Scope Boundaries — Do NOT Do These

- Do NOT modify `voice-app/` — this story is plugin-only
- Do NOT add a new `loaded N account bindings` log AND remove the `channel registered` log — keep both (Story 1.1 AC still requires "channel registered")
- Do NOT add `allowFrom` enforcement — that is Epic 3
- Do NOT add session persistence — in-memory Map only (OpenClaw bug #3290 unchanged)
- Do NOT refactor `webhook-server.js` — only add the WARN log line for the binding-not-found case

### Project Structure Notes

- All changes within `openclaw-plugin/` — no cross-boundary modifications
- `openclaw-plugin/test/` already has 6 test files; no new test files needed
- No detected conflicts or variances with project structure

### References

- [Source: epics.md#Story 2.2] — Acceptance criteria and user story
- [Source: architecture.md#HTTP Contract] — 404 for unknown accountId
- [Source: architecture.md#Logging Rules] — `[sip-voice]` prefix required; PII at DEBUG only
- [Source: openclaw-plugin/src/index.js:21-27] — activate() accounts/bindings loading
- [Source: openclaw-plugin/src/webhook-server.js:26-61] — bindingMap construction and lookup (already complete for ACs 2-4)
- [Source: openclaw-plugin/openclaw.plugin.json] — configSchema already present (AC 5 satisfied)
- [Source: openclaw-plugin/test/index.test.js:96-133] — log tests to update
- [Source: openclaw-plugin/test/webhook.test.js:150-165] — cephanie test to mirror
- [Source: prd.md#FR2] — Configure multiple extensions with distinct agents
- [Source: prd.md#FR22] — Route voice query to correct agent by accountId
- [Source: prd.md#FR29] — Agent bindings in plugin config

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- Initial test run failure: `logLines[0].includes('channel registered')` failed because new `loaded N account bindings` log shifted `channel registered` to `logLines[1]`. Fixed by updating index references in the existing test.

### Completion Notes List

- Task 1: Added `logger.info(\`loaded ${bindings.length} account bindings\`)` to `activate()` in `index.js`, placed before the existing `channel registered` log line. Both logs preserved.
- Task 2: Updated `index.test.js` — changed log count assertion from 1 to 2, shifted `logLines` indices from `[0]` to `[1]` for `channel registered` checks, added new test verifying the `loaded N account bindings` log line with `[sip-voice]` prefix and correct count.
- Task 3: Added cephanie routing test to `webhook.test.js` — mirrors morpheus test, asserts `agentId === 'cephanie'` and response body.
- Task 4: Verified AC 4 (404 test exists, added `logger.warn` for WARN level requirement) and AC 5 (`configSchema` already present). All 202 tests pass (96 cli + 30 voice-app + 76 plugin). 0 lint errors.

### Review Follow-ups (AI) — RESOLVED

- [x] [AI-Review][MEDIUM] No test verifying WARN log fires for unknown accountId — added `'webhook - POST /voice/query unknown accountId logs WARN'` test [webhook.test.js:257]
- [x] [AI-Review][MEDIUM] Fragile `includes('2')` assertion matches timestamp digits — changed to `includes('loaded 2 account bindings')` [index.test.js:158]
- [x] [AI-Review][LOW] No zero-bindings edge case for "loaded N account bindings" test — added `'index - activate() logs "loaded 0 account bindings" when no bindings configured'` [index.test.js]
- [N/A] [AI-Review][LOW] Inconsistent log format (template literal vs structured data) — format is mandated by AC 1 exact text; no change warranted

### Change Log

- 2026-02-24: Implemented Story 2.2 — added `loaded N account bindings` log to activate(), added WARN log for unknown accountId, added 2 new tests (binding log + cephanie routing), updated 3 existing test assertions.
- 2026-02-24: Code review fixes — strengthened binding count assertion, added WARN log test for unknown accountId, added zero-bindings edge case test. 204 tests pass total (96 cli + 30 voice-app + 78 plugin).

### File List

- openclaw-plugin/src/index.js — MODIFIED (+1 log line in activate())
- openclaw-plugin/src/webhook-server.js — MODIFIED (+1 logger.warn line before 404 return)
- openclaw-plugin/test/index.test.js — MODIFIED (updated log count/index assertions, +2 new tests)
- openclaw-plugin/test/webhook.test.js — MODIFIED (+2 tests: cephanie routing + unknown accountId WARN)

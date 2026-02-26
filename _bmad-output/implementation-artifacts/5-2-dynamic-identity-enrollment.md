# Story 5.2: Dynamic Identity Enrollment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a caller who is new to the system,
I want the agent to recognize I'm a first-time caller and guide me through a quick enrollment,
So that future calls know who I am and share my session context across all my channels — without the operator needing to manually configure anything.

## Acceptance Criteria

1. **Given** an inbound call arrives from a phone number not present in `session.identityLinks`
   **When** the plugin processes the initial query
   **Then** the plugin passes `{ isFirstCall: true }` alongside the query so the agent knows to run enrollment

2. **Given** the agent detects `isFirstCall: true` in its context
   **When** generating the opening of the conversation
   **Then** the agent introduces itself and asks the caller their name and which channels they use (Discord, Telegram, web UI, etc.)

3. **Given** the caller provides their name and channel information during enrollment
   **When** the agent calls the `link_identity({ name, channels })` tool
   **Then** the plugin loads `openclaw.json`, adds `session.identityLinks[name] = ["sip-voice:<phoneNumber>", ...channels]`, and writes the config back via `api.runtime.config.writeConfigFile()`

4. **Given** `link_identity` is called while another enrollment is in progress (race condition)
   **When** the config is written
   **Then** the write is serialized — no concurrent writes corrupt the config (mutex or sequential queue)

5. **Given** a caller's phone number IS present in `session.identityLinks`
   **When** the plugin processes the initial query
   **Then** the plugin passes `{ isFirstCall: false, identity: "<canonicalName>" }` so the agent addresses the caller by name

6. **Given** the `link_identity` tool call fails (config write error)
   **When** the error occurs
   **Then** the plugin logs at ERROR level and returns an error to the agent; the call continues normally without enrollment persisted

## Tasks / Subtasks

- [x] Task 1: Create identity resolution module (AC: #1, #5)
  - [x] 1.1 Create `openclaw-plugin/src/identity.js` — resolves `peerId` to canonical name from `session.identityLinks`
  - [x] 1.2 `resolveIdentity(config, peerId)` — scans all `session.identityLinks` entries for a matching `sip-voice:<peerId>` value; returns `{ isFirstCall, identity }` object
  - [x] 1.3 Handle both formats: `sip-voice:+15551234567` and `sip-voice:15551234567` (normalize for comparison)
  - [x] 1.4 Return `{ isFirstCall: true, identity: null }` if no match found
  - [x] 1.5 Return `{ isFirstCall: false, identity: "<canonicalName>" }` if match found

- [x] Task 2: Create `link_identity` tool registration (AC: #3, #4, #6)
  - [x] 2.1 In `index.js`, register `link_identity` tool via `api.registerTool()` during `register()`
  - [x] 2.2 Tool accepts `{ name, channels, peerId }` — name is canonical identity, channels is array of cross-channel identifiers, peerId is the phone number being enrolled
  - [x] 2.3 Implement enrollment mutex (simple promise-based queue) to serialize concurrent writes (AC: #4)
  - [x] 2.4 Tool loads config via `api.config` (the full OpenClaw config object), adds `session.identityLinks[name] = ["sip-voice:<peerId>", ...channels]`
  - [x] 2.5 Write config back via `api.runtime.config.writeConfigFile(cfg)`
  - [x] 2.6 On success return `{ ok: true, identity: name }`; on failure log ERROR and return `{ ok: false, error: "<message>" }` — never throw

- [x] Task 3: Wire identity resolution into webhook query handler (AC: #1, #5)
  - [x] 3.1 In `webhook-server.js`, accept a new `resolveIdentity` callback in config (same pattern as `queryAgent`)
  - [x] 3.2 In `POST /voice/query` handler, call `resolveIdentity(peerId)` before routing to agent
  - [x] 3.3 Pass `isFirstCall` and `identity` as additional context alongside the `prompt` to `queryAgent`
  - [x] 3.4 Update `queryAgent` signature to accept identity context: `queryAgent(agentId, sessionId, prompt, peerId, identityContext)`

- [x] Task 4: Pass identity context through to OpenClaw agent (AC: #1, #2, #5)
  - [x] 4.1 In `index.js` `queryAgent`, prepend identity context to the prompt string sent to `runEmbeddedPiAgent`
  - [x] 4.2 Format: `[CALLER CONTEXT: First-time caller, no identity on file]` or `[CALLER CONTEXT: Known caller, identity="<name>"]`
  - [x] 4.3 This is a prompt-level injection — no API-level context passing needed (OpenClaw processes it as part of the message)

- [x] Task 5: Write tests (AC: #1, #3, #4, #5, #6)
  - [x] 5.1 Unit test `identity.js`: known caller resolution, unknown caller, format normalization, empty identityLinks
  - [x] 5.2 Unit test `link_identity` tool: successful enrollment, concurrent enrollment (mutex test), config write failure, missing params
  - [x] 5.3 Integration test: webhook query with identity resolution (mock resolveIdentity)
  - [x] 5.4 Verify all existing 322 tests still pass (349 total now — 27 new tests added)

## Dev Notes

### Design Context

**Two separate identity systems (DO NOT conflate):**

| System | Location | Purpose |
|---|---|---|
| `session.identityLinks` | `openclaw.json` (top-level `session` key) | Cross-channel session merging — same person on different channels shares one DM session per agent |
| `identityLinks` in plugin config | `api.pluginConfig.identityLinks` | Outbound callback resolution — Story 5.5 scope, NOT this story |

This story ONLY touches `session.identityLinks` in the top-level OpenClaw config. The plugin-scoped `identityLinks` is a separate thing for Story 5.5.

**Security boundary:** `allowFrom` in `devices.json` (voice-app side) remains the hard security gate. Dynamic enrollment only runs AFTER the phone number has already passed the `allowFrom` check. Enrollment is about personalization, not authentication.

### What Already Exists (DO NOT Recreate)

- `openclaw-plugin/src/webhook-server.js` — Express webhook server with `/voice/query` handler (modify to add identity resolution)
- `openclaw-plugin/src/index.js` — Plugin entry point with `queryAgent` function (modify to pass identity context and register tool)
- `openclaw-plugin/src/session-store.js` — In-memory session Map (unchanged)
- `openclaw-plugin/src/auth.js` — Bearer token middleware (unchanged)
- `openclaw-plugin/src/logger.js` — `[sip-voice]` prefixed logger (unchanged)
- `openclaw-plugin/src/outbound-client.js` — Outbound call HTTP client (unchanged)
- `voice-app/lib/openclaw-bridge.js` — Bridge that POSTs to `/voice/query` (unchanged — already sends `peerId`)

### What You Are Building

1. **NEW file: `openclaw-plugin/src/identity.js`** — Identity resolution module
2. **MODIFY: `openclaw-plugin/src/index.js`** — Add `link_identity` tool registration + pass identity context in `queryAgent`
3. **MODIFY: `openclaw-plugin/src/webhook-server.js`** — Add identity resolution step before agent routing
4. **NEW tests: `openclaw-plugin/test/identity.test.js`**

### Critical Implementation Rules

- **CommonJS only** — `module.exports`, `require()`, no `import` statements
- **Async/non-blocking** — all I/O via async/await, no sync calls (plugin runs in OpenClaw gateway event loop)
- **Logger discipline** — use `require('./logger')` which prefixes `[sip-voice]`; phone numbers at DEBUG only
- **Never crash on failure** — `link_identity` must catch all errors, log them, return error object

### Identity Resolution Implementation

```js
// identity.js
'use strict';
const logger = require('./logger');

/**
 * Resolve a peerId (phone number) to a canonical identity name
 * by scanning session.identityLinks in the OpenClaw config.
 *
 * @param {object} config - Full OpenClaw config (api.config)
 * @param {string} peerId - Caller phone number
 * @returns {{ isFirstCall: boolean, identity: string|null }}
 */
function resolveIdentity(config, peerId) {
  const links = (config && config.session && config.session.identityLinks) || {};

  // Normalize peerId for comparison — strip leading '+'
  const normalizedPeer = peerId ? peerId.replace(/^\+/, '') : '';

  for (const [name, channels] of Object.entries(links)) {
    if (!Array.isArray(channels)) continue;
    for (const ch of channels) {
      if (!ch.startsWith('sip-voice:')) continue;
      const linked = ch.slice('sip-voice:'.length).replace(/^\+/, '');
      if (linked === normalizedPeer) {
        logger.debug('identity resolved', { identity: name });
        return { isFirstCall: false, identity: name };
      }
    }
  }

  logger.debug('no identity match — first call');
  return { isFirstCall: true, identity: null };
}

module.exports = { resolveIdentity };
```

### Enrollment Mutex Implementation

The `link_identity` tool must serialize concurrent writes to `openclaw.json`. Use a simple promise-chain mutex:

```js
// In index.js — simple enrollment mutex
let _enrollmentQueue = Promise.resolve();

function enrollmentMutex(fn) {
  _enrollmentQueue = _enrollmentQueue.then(fn, fn);
  return _enrollmentQueue;
}
```

This ensures if two callers enroll simultaneously, the second write waits for the first to complete — preventing config corruption.

### `link_identity` Tool Registration

```js
// In register(api) — after existing setup
api.registerTool({
  name: 'link_identity',
  schema: {
    // TypeBox or JSON Schema — match OpenClaw plugin convention
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Canonical name for the caller (e.g., "hue")' },
      channels: { type: 'array', items: { type: 'string' }, description: 'Additional channel identifiers (e.g., ["discord:987654321"])' },
      peerId: { type: 'string', description: 'Phone number being enrolled' },
    },
    required: ['name', 'peerId'],
  },
  handler: async ({ name, channels, peerId }) => {
    return enrollmentMutex(async () => {
      try {
        const cfg = api.config;
        cfg.session = cfg.session || {};
        cfg.session.identityLinks = cfg.session.identityLinks || {};

        const sipChannel = `sip-voice:${peerId.replace(/^\+/, '')}`;
        cfg.session.identityLinks[name] = [sipChannel, ...(channels || [])];

        await api.runtime.config.writeConfigFile(cfg);
        logger.info('identity enrolled', { name, channelCount: (channels || []).length + 1 });
        return { ok: true, identity: name };
      } catch (err) {
        logger.error('identity enrollment failed', { name, error: err.message });
        return { ok: false, error: err.message };
      }
    });
  },
});
```

### Webhook Query Handler Modification

In `webhook-server.js`, the `POST /voice/query` handler needs to:
1. Accept a `resolveIdentity` callback in the config object
2. Call it with `peerId` before routing to the agent
3. Pass identity context to `queryAgent`

```js
// In createServer config:
// config.resolveIdentity - async (peerId) => { isFirstCall, identity }

// In POST /voice/query handler, after validation:
let identityContext = { isFirstCall: true, identity: null };
if (config.resolveIdentity && peerId) {
  identityContext = config.resolveIdentity(peerId);
}

// Pass to queryAgent:
const response = await queryAgent(agentId, sessionId, prompt, peerId, identityContext);
```

### Identity Context Passing to Agent

In `index.js` `queryAgent`, prepend caller context to the prompt:

```js
// Before runEmbeddedPiAgent call:
let enrichedPrompt = prompt;
if (identityContext) {
  const ctxLine = identityContext.isFirstCall
    ? '[CALLER CONTEXT: First-time caller, no identity on file]'
    : `[CALLER CONTEXT: Known caller, identity="${identityContext.identity}"]`;
  enrichedPrompt = ctxLine + '\n' + prompt;
}
```

This is a prompt-level approach — the simplest pattern that works with `runEmbeddedPiAgent`. No API-level metadata passing is needed.

### Config Access Patterns

**Reading config:** Use `api.config` (the full OpenClaw config object, available synchronously after `register()` is called). This contains `session.identityLinks` if already configured.

**Writing config:** Use `api.runtime.config.writeConfigFile(cfg)` — async, writes the full config back to `~/.openclaw/openclaw.json`. This is why the enrollment mutex is critical — two concurrent writes would cause a last-write-wins race.

**IMPORTANT:** `api.config` is the config reference. Check if it's a live reference or a snapshot. If snapshot, you may need `api.runtime.config.loadConfig()` to get fresh data before the write. Test this empirically — if `api.config` reflects writes immediately, no reload needed. If not, load fresh config before each write in the mutex.

### Phone Number Format

- `peerId` arrives from voice-app as the caller's phone number (format depends on PBX — typically `+15551234567` or `15551234567`)
- Normalize by stripping leading `+` for comparison
- Store in `identityLinks` WITHOUT `+`: `sip-voice:15551234567` (consistent with outbound-client convention from Story 5.1)

### Testing Standards

- **Framework**: Node.js built-in `node:test` runner (`node --test test/**/*.test.js`)
- **Pattern**: Mock `api.config` and `api.runtime.config.writeConfigFile` for unit tests
- **Coverage expectations**: All success/error paths in identity.js and link_identity tool
- **Existing test count**: 322 total — must not break any
- **Mutex test**: Use `Promise.all` with two concurrent `link_identity` calls to verify serialization

### Previous Story Learnings (from Story 5.1)

1. **No `axios` in plugin** — Story 5.1 confirmed `axios` is NOT in `openclaw-plugin/package.json`. Use Node.js built-in HTTP for any HTTP calls (though this story doesn't need HTTP calls — it's all in-process)
2. **Logger discipline** — use `require('./logger')`, not `console.log`; PII at DEBUG only
3. **Error handling** — never throw from tool handlers; return error objects
4. **Test naming** — follow `test/<feature-name>.test.js` convention
5. **Plugin exposes internal functions** — Story 5.1 attached `placeCall` to `plugin.placeCall` for future tool registration. Same pattern may apply here if `link_identity` needs to be accessible from other plugin code.
6. **`api.pluginConfig`** (NOT `api.getConfig()`) — confirmed in Story 5.1 and all prior stories

### Git Intelligence

Recent commits show:
- `b53259a feat(story-5-1)` — outbound-client.js, index.js modified, plugin manifest updated
- Code review fixes pattern: input validation, guard clauses, startup warnings
- Test count baseline: 322 (107 CLI + 111 voice-app + 104 plugin)

### What This Story Does NOT Include

- **Dynamic greeting** — Story 5.3 (changes to `conversation-loop.js`)
- **`place_call` tool** — Story 5.4 (tool registration for outbound calling)
- **Outbound identity resolution** — Story 5.5 (plugin-scoped `identityLinks` for callback lookup)
- **SKILL.md** — Story 5.4 (agent skill documentation)
- **Voice-app changes** — NONE. This story is 100% plugin-side.

### Project Structure Notes

- New file: `openclaw-plugin/src/identity.js` — identity resolution module
- Modified: `openclaw-plugin/src/index.js` — tool registration + identity context in queryAgent
- Modified: `openclaw-plugin/src/webhook-server.js` — identity resolution before agent routing
- New test: `openclaw-plugin/test/identity.test.js`
- No voice-app changes needed — `openclaw-bridge.js` already sends `peerId` in every query

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.2] — Story definition and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Identity-Enrollment-Design] — Full architecture spec with code examples
- [Source: _bmad-output/planning-artifacts/prd.md#FR36] — First-call identity enrollment requirement
- [Source: openclaw-plugin/src/webhook-server.js] — Current webhook handler (modify for identity resolution)
- [Source: openclaw-plugin/src/index.js] — Plugin entry point (modify for tool registration and context passing)
- [Source: voice-app/lib/openclaw-bridge.js] — Bridge already sends peerId (no changes needed)
- [Source: docs/openclaw-plugin-architecture.md#registerTool] — Tool registration API reference
- [Source: _bmad-output/implementation-artifacts/5-1-plugin-triggered-outbound-calls.md] — Previous story learnings

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no debug investigation needed.

### Completion Notes List

- Created `openclaw-plugin/src/identity.js` with `resolveIdentity()` and `createLinkIdentityHandler()` factory
- Handler factory pattern chosen to keep mutex + tool handler testable in isolation from `index.js`
- Enrollment mutex uses promise-chain `.then(fn, fn)` pattern — resilient to both resolved and rejected prior tasks
- Phone number normalization strips leading `+` for comparison, stores without `+` (consistent with outbound-client from Story 5.1)
- `identityContext` always passed to `queryAgent` (default `{ isFirstCall: true, identity: null }` when resolveIdentity not configured or peerId absent)
- Prompt injection format uses human-readable labels rather than key=value to be more natural for LLM context
- All 322 existing tests preserved; 27 new tests added (20 identity unit, 3 webhook integration, 4 index tool registration)
- `api.registerTool` added to `createMockApi` in `index.test.js` to support existing tests that call `register(api)`

### File List

- `openclaw-plugin/src/identity.js` (NEW)
- `openclaw-plugin/src/index.js` (MODIFIED — link_identity tool, queryAgent identity context, resolveIdentity wired to createServer)
- `openclaw-plugin/src/webhook-server.js` (MODIFIED — resolveIdentity callback, identityContext passed to queryAgent)
- `openclaw-plugin/test/identity.test.js` (NEW)
- `openclaw-plugin/test/index.test.js` (MODIFIED — registerTool in mock, 4 new tool registration tests)
- `openclaw-plugin/test/webhook.test.js` (MODIFIED — 3 new identity integration tests)

### Change Log

- 2026-02-25: Story 5.2 implemented — dynamic identity enrollment via link_identity tool + caller context injection
- 2026-02-25: Code review fixes — H1: in-memory rollback on write failure (AC 6 compliance); H2: missing params tests added (5 new tests); M1: rollback pattern resolves live-vs-snapshot concern; M2: await resolveIdentityFn for async compatibility; M3: identityContext assertion added to existing queryAgent arg test. Total tests: 353.

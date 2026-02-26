# Story 5.4: Agent Tools & SKILL.md

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an OpenClaw agent (Morpheus, Cephanie),
I want `place_call` and `link_identity` tools registered by the plugin and a `SKILL.md` loaded into my context,
So that I know when and how to initiate outbound calls and enroll new callers autonomously.

## Acceptance Criteria

1. **Given** the plugin is loaded by the OpenClaw gateway
   **When** an agent's context is initialized
   **Then** both `place_call` and `link_identity` tools are available and `SKILL.md` is loaded

2. **Given** the agent calls `place_call` with `{ to, device, message, mode }`
   **When** the tool executes
   **Then** it POSTs to `POST /api/outbound-call` on the voice-app and returns `{ callId, status }` to the agent

3. **Given** the agent calls `link_identity` with `{ name, channels }`
   **When** the tool executes
   **Then** the plugin writes `session.identityLinks[name]` to `openclaw.json` and returns `{ ok: true, identity: name }`

4. **Given** the voice-app is unreachable when `place_call` is invoked
   **When** the HTTP request fails
   **Then** the tool returns an error object `{ error: string }` and the agent falls back to delivering the update via the primary channel only

5. **Given** a user says "call me when this task is done"
   **When** the task completes
   **Then** the agent posts the full result to the primary channel first, then calls with a brief summary

6. **Given** `SKILL.md` is loaded into the agent's context
   **When** the agent encounters an unenrolled first-time caller
   **Then** the agent follows the enrollment instructions: ask for name, ask for channels, call `link_identity`

## Tasks / Subtasks

- [x] Task 1: Register `place_call` as an agent tool (AC: #1, #2, #4)
  - [x] 1.1 Add `api.registerTool({ name: 'place_call', schema, handler })` in `index.js` register() — alongside existing `link_identity` registration
  - [x] 1.2 Schema: `{ to: string (required), device: string (required), message: string (required), mode: string (optional, enum: announce|conversation) }`
  - [x] 1.3 Handler: call existing `outboundClient.placeCall({ voiceAppUrl, to, device, message, mode })` — already implemented and tested
  - [x] 1.4 Handler returns `{ callId, status }` on success or `{ error: string }` on failure — matches outbound-client return shape
  - [x] 1.5 Remove the "Prepared for Story 5.4" comment on line 82 of index.js

- [x] Task 2: Create `SKILL.md` for agent context (AC: #1, #5, #6)
  - [x] 2.1 Create `openclaw-plugin/skills/SKILL.md` — this is the agent-facing skill document
  - [x] 2.2 Document `place_call` tool: parameters, modes (announce vs conversation), when to use each mode
  - [x] 2.3 Document `link_identity` tool: parameters, enrollment flow, when to trigger
  - [x] 2.4 Document call continuity behavior: greeting personalization, conversation resumption
  - [x] 2.5 Include behavioral rules: always post full result to primary channel FIRST, then call with brief voice summary
  - [x] 2.6 Include error handling guidance: what to do when voice-app unreachable, when call fails

- [x] Task 3: Update `openclaw.plugin.json` manifest (AC: #1)
  - [x] 3.1 Add `"skills": ["./skills"]` to manifest — tells OpenClaw to load SKILL.md from the skills directory

- [x] Task 4: Write tests for `place_call` tool registration (AC: #1, #2, #4)
  - [x] 4.1 Test: `register()` calls `api.registerTool()` with `place_call` (in `index.test.js`)
  - [x] 4.2 Test: `place_call` tool has schema with required `to`, `device`, `message` and optional `mode`
  - [x] 4.3 Test: `place_call` tool has an async handler function
  - [x] 4.4 Test: `register()` calls `api.registerTool()` exactly 2 times (link_identity + place_call)
  - [x] 4.5 Test: `place_call` handler delegates to `outboundClient.placeCall()` with correct params (in dedicated test file)
  - [x] 4.6 Test: `place_call` handler returns `{ callId, status }` on success
  - [x] 4.7 Test: `place_call` handler returns `{ error }` when voice-app unreachable
  - [x] 4.8 Test: `place_call` handler passes `voiceAppUrl` from plugin config
  - [x] 4.9 Test: `place_call` handler works when `mode` is omitted (defaults to 'announce')
  - [x] 4.10 Verify all existing 369 tests still pass (379 total, 0 failures)

- [x] Task 5: Verify SKILL.md integration (AC: #1, #6)
  - [x] 5.1 Verify `openclaw.plugin.json` is valid JSON after manifest update
  - [x] 5.2 Verify `skills/SKILL.md` exists and is loadable
  - [x] 5.3 Add manifest test: `openclaw.plugin.json` contains `skills` field pointing to `./skills`

## Dev Notes

### Design Context

**FR32 (place_call + SKILL.md):** The plugin registers a `place_call` tool so agents can autonomously initiate outbound calls. A `SKILL.md` file gives agents awareness of when and how to use the capability. This is the "last mile" — the outbound infrastructure (outbound-client, outbound-handler, outbound-routes) is already complete from Story 5.1.

**FR36 (link_identity):** Already registered as a tool in Story 5.2. This story ensures SKILL.md documents the enrollment flow so agents know when and how to trigger it.

**Key insight:** This story is ~80% new code (place_call tool registration + SKILL.md + tests) and ~20% wiring (manifest update, comment cleanup). The heavy infrastructure work is done — outbound-client.js is fully implemented with 14 tests passing.

### What Already Exists (DO NOT Recreate)

- `openclaw-plugin/src/outbound-client.js` — Complete HTTP client for placing outbound calls via voice-app REST API. 14 tests in `test/outbound-client.test.js`. Handles validation, phone number normalization, timeout, error categorization. **DO NOT modify this file.**
- `openclaw-plugin/src/index.js:82-83` — `plugin.placeCall = (params) => outboundClient.placeCall({ voiceAppUrl, ...params })` — internal function already wired, just needs to be exposed as a tool
- `openclaw-plugin/src/index.js:87-103` — `link_identity` tool already registered with schema and handler. **DO NOT modify this registration.**
- `openclaw-plugin/src/identity.js` — `createLinkIdentityHandler(api)` factory function for link_identity. **DO NOT modify.**
- `voice-app/lib/outbound-routes.js` — `POST /api/outbound-call` endpoint accepting `{ to, message, mode, device }`. **DO NOT modify.**
- `voice-app/lib/outbound-handler.js` — SIP outbound call initiation via drachtio. **DO NOT modify.**
- `openclaw-plugin/test/index.test.js` — 20 existing tests including 3 for link_identity tool registration. **ADD tests here, do not modify existing tests.**
- `openclaw-plugin/test/outbound-client.test.js` — 14 tests for outbound-client. **DO NOT modify.**
- `docs/CLAUDE-CODE-SKILL.md` — Reference SKILL.md for Claude Code CLI (Python-based). The new SKILL.md is for OpenClaw agents (different audience — agents, not CLI users).

### What You Are Building

1. **MODIFY: `openclaw-plugin/src/index.js`** — Add `api.registerTool({ name: 'place_call', ... })` call in `register()`, remove "Prepared for Story 5.4" comment
2. **NEW: `openclaw-plugin/skills/SKILL.md`** — Agent-facing skill document for voice calling and identity enrollment
3. **MODIFY: `openclaw-plugin/openclaw.plugin.json`** — Add `"skills": ["./skills"]`
4. **MODIFY: `openclaw-plugin/test/index.test.js`** — Add place_call tool registration tests (alongside existing link_identity tests)
5. **NEW: `openclaw-plugin/test/place-call-tool.test.js`** — Dedicated tests for place_call handler behavior

### Critical Implementation Rules

- **CommonJS only** — `module.exports`, `require()`, no `import` statements
- **Do NOT modify outbound-client.js** — It's complete and tested; the place_call tool handler simply delegates to it
- **Do NOT modify link_identity registration** — It's complete and tested; SKILL.md just documents it
- **Schema must match outbound-client params** — `to` (string, required), `device` (string, required), `message` (string, required), `mode` (string, optional)
- **Handler returns outbound-client result directly** — `outboundClient.placeCall()` already returns `{ callId, status }` or `{ error }`. No transformation needed.
- **Logger discipline** — use existing `logger` instance; phone numbers at DEBUG only
- **[sip-voice] prefix** — all plugin log lines must include it

### Implementation Reference: place_call Tool Registration

Add in `index.js` `register()` method, after the link_identity registration (line 103):

```js
// Register place_call agent tool — allows agents to initiate outbound calls
// via the voice-app REST API.
api.registerTool({
  name: 'place_call',
  schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Destination phone number (E.164) or extension' },
      device: { type: 'string', description: 'Extension/device name to call from (e.g., "9000")' },
      message: { type: 'string', description: 'TTS message to play when call is answered (max 1000 chars)' },
      mode: {
        type: 'string',
        enum: ['announce', 'conversation'],
        description: 'Call mode: "announce" (one-way, default) or "conversation" (two-way)',
      },
    },
    required: ['to', 'device', 'message'],
  },
  handler: async ({ to, device, message, mode }) => {
    logger.info('place_call tool invoked', { device });
    const result = await outboundClient.placeCall({ voiceAppUrl, to, device, message, mode });
    if (result.error) {
      logger.warn('place_call failed', { error: result.error });
    } else {
      logger.info('place_call succeeded', { callId: result.callId });
    }
    return result;
  },
});
```

**Important:** The handler calls `outboundClient.placeCall()` which already handles:
- Input validation (missing to/device/message, message length)
- Phone number normalization (strips leading +)
- HTTP POST to voice-app
- Timeout (10s)
- Error categorization (unreachable, timeout, non-2xx, invalid JSON)
- Returns `{ callId, status }` or `{ error }` — no transformation needed

### SKILL.md Structure

The SKILL.md is loaded into every agent's context by the OpenClaw plugin loader. It should cover:

1. **Voice Calling (place_call tool)**
   - Two modes: `announce` (one-way notification) and `conversation` (two-way)
   - When to use announce: task completion callbacks, alerts, status updates
   - When to use conversation: complex discussions, decisions needed, follow-up Q&A
   - Always post full result to primary channel FIRST, then call with brief summary
   - Message should be concise (voice-friendly, <50 words)
   - Error handling: if call fails, inform user via primary channel

2. **Identity Enrollment (link_identity tool)**
   - When: first-time caller detected (no identity on file)
   - Flow: ask caller's name, optionally ask for other channels, call link_identity
   - Parameters: `name` (required), `peerId` (required — phone number), `channels` (optional)

3. **Call Continuity**
   - Greet returning callers by name
   - Reference previous conversation if relevant
   - Keep voice greetings concise

### Manifest Update

Add `"skills"` to `openclaw.plugin.json`:

```json
{
  "id": "openclaw-sip-voice",
  "version": "1.0.0",
  "name": "SIP Voice Channel",
  "description": "SIP telephone channel for OpenClaw agents via FreePBX",
  "main": "src/index.js",
  "skills": ["./skills"],
  "configSchema": { ... }
}
```

### Testing Standards

- **Framework**: Node.js built-in `node:test` runner
- **Existing plugin tests**: 136 in `openclaw-plugin/test/` — follow `index.test.js` patterns exactly
- **Key mocks needed**: `outboundClient.placeCall` (for handler tests), `api.registerTool` (for registration tests — already mocked in `createMockApi`)
- **Total existing test count**: 369 (107 CLI + 126 voice-app + 136 plugin) — must not break any
- **New test files**:
  - Add tests to `openclaw-plugin/test/index.test.js` for place_call registration (alongside existing link_identity tests)
  - New `openclaw-plugin/test/place-call-tool.test.js` for handler behavior tests

### Test Patterns to Follow

From `index.test.js` (link_identity tests, lines 285-320):

```js
test('index - register() calls api.registerTool() with place_call', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const toolNames = api._calls.registerTool.map(t => t.name);
  assert.ok(toolNames.includes('place_call'), 'Must register place_call tool');
});

test('index - place_call tool has schema with required to, device, and message', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const tool = api._calls.registerTool.find(t => t.name === 'place_call');
  assert.ok(tool, 'place_call tool must be registered');
  assert.ok(tool.schema, 'tool must have a schema');
  assert.ok(Array.isArray(tool.schema.required), 'schema.required must be an array');
  assert.ok(tool.schema.required.includes('to'), 'schema must require to');
  assert.ok(tool.schema.required.includes('device'), 'schema must require device');
  assert.ok(tool.schema.required.includes('message'), 'schema must require message');
});
```

For handler tests in `place-call-tool.test.js`, mock `outbound-client` via `require.cache` injection (same pattern as webhook-server mock in index.test.js):

```js
// Mock outbound-client before loading index.js
let mockPlaceCallResult = { callId: 'test-call-123', status: 'initiated' };
let lastPlaceCallArgs = null;
require.cache[require.resolve('../src/outbound-client')] = {
  id: require.resolve('../src/outbound-client'),
  filename: require.resolve('../src/outbound-client'),
  loaded: true,
  exports: {
    placeCall: async (params) => {
      lastPlaceCallArgs = params;
      return mockPlaceCallResult;
    },
  },
};
```

### Previous Story Learnings (from Story 5.3)

1. **Handler factory pattern** — Story 5.2 used `createLinkIdentityHandler()` factory for testability. For `place_call`, the handler is simple enough to be inline — it just delegates to `outboundClient.placeCall()` with logging. No factory needed.
2. **Prompt injection format** — Story 5.2 uses `[CALLER CONTEXT: ...]` prefix. SKILL.md should reference this format so agents understand the context they receive.
3. **Test count went to 369** (354 + 15 from Story 5.3). Must verify all 369 still pass.
4. **`skipGreeting: true` fix** — Story 5.3 had to add `skipGreeting: true` to existing test suites. Be aware that new tests using conversation-loop must include this flag.
5. **No new dependencies** — outbound-client uses Node.js built-in `http`/`https`. No npm packages needed.

### Git Intelligence

Recent commits:
- `d60bed7 Merge pull request #26 from huetruong/feature/story-5-3-dynamic-greeting-and-call-continuity` — latest merge
- `7c9bf24 feat(story-5-3): dynamic greeting & call continuity (#26)` — greeting replacement done
- `2596231 feat(story-5-2): dynamic identity enrollment via link_identity tool (#25)` — identity + link_identity tool done
- `b53259a feat(story-5-1): plugin-triggered outbound calls (#24)` — outbound infrastructure done

The current branch is `feature/story-5-4-agent-tools-and-skill-md` — already created and tracking main.

### What This Story Does NOT Include

- **outbound-client.js changes** — Already complete (Story 5.1)
- **outbound-handler.js changes** — Already complete (Story 5.1)
- **outbound-routes.js changes** — Already complete (Story 5.1)
- **link_identity tool changes** — Already registered (Story 5.2)
- **identity.js changes** — Already complete (Story 5.2)
- **conversation-loop.js changes** — Already complete (Story 5.3)
- **Identity resolution for outbound callbacks** — Story 5.5 scope
- **Cross-channel response delivery** — Story 5.6 scope

### Project Structure Notes

- Modified: `openclaw-plugin/src/index.js` — Add place_call tool registration
- Modified: `openclaw-plugin/openclaw.plugin.json` — Add `"skills"` manifest entry
- Modified: `openclaw-plugin/test/index.test.js` — Add place_call registration tests
- New: `openclaw-plugin/skills/SKILL.md` — Agent-facing skill document
- New: `openclaw-plugin/test/place-call-tool.test.js` — place_call handler tests
- No voice-app files modified
- No new npm dependencies

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.4] — Story definition and acceptance criteria (lines 715-752)
- [Source: _bmad-output/planning-artifacts/prd.md#FR32] — place_call + SKILL.md requirement (line 415)
- [Source: _bmad-output/planning-artifacts/prd.md#FR36] — link_identity enrollment requirement (line 419)
- [Source: _bmad-output/planning-artifacts/architecture.md#Identity-Enrollment-Design] — link_identity architecture (lines 298-341)
- [Source: openclaw-plugin/src/index.js#L82-L103] — Current plugin.placeCall internal + link_identity tool registration
- [Source: openclaw-plugin/src/outbound-client.js] — Complete outbound HTTP client (unchanged)
- [Source: openclaw-plugin/openclaw.plugin.json] — Plugin manifest (add skills entry)
- [Source: openclaw-plugin/test/index.test.js#L285-L320] — Existing link_identity test patterns (follow for place_call)
- [Source: docs/openclaw-plugin-architecture.md#L80] — Manifest skills field documentation
- [Source: docs/CLAUDE-CODE-SKILL.md] — Reference SKILL.md for Claude Code CLI (different audience but structural reference)
- [Source: _bmad-output/implementation-artifacts/5-3-dynamic-greeting-and-call-continuity.md] — Previous story learnings
- [Source: _bmad-output/implementation-artifacts/5-1-plugin-triggered-outbound-calls.md] — Outbound infrastructure story

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no blockers encountered.

### Completion Notes List

- Registered `place_call` agent tool in `index.js` after `link_identity` registration; handler delegates directly to `outboundClient.placeCall()` with logging. Removed "Prepared for Story 5.4" comment.
- Created `openclaw-plugin/skills/SKILL.md` covering: place_call (modes, behavioral rules, error handling), link_identity (enrollment flow), and call continuity (returning caller greetings).
- Added `"skills": ["./skills"]` to `openclaw.plugin.json` manifest.
- Added 4 place_call registration tests to `index.test.js` + updated existing `registerTool.length` assertion (1→2) to reflect both tools.
- Added 5 handler behavior tests in new `place-call-tool.test.js` (delegation, success return, error return, voiceAppUrl pass-through, mode-omitted).
- Added manifest test verifying `skills` field.
- All 379 tests pass (107 CLI + 126 voice-app + 146 plugin). No regressions.

### File List

- `openclaw-plugin/src/index.js` (modified) — added place_call tool registration, removed "Prepared for Story 5.4" comment
- `openclaw-plugin/skills/SKILL.md` (new) — agent-facing skill document
- `openclaw-plugin/openclaw.plugin.json` (modified) — added `"skills": ["./skills"]`
- `openclaw-plugin/test/index.test.js` (modified) — added 4 place_call registration tests + updated registerTool count assertion
- `openclaw-plugin/test/place-call-tool.test.js` (new) — 5 handler behavior tests

## Change Log

- 2026-02-26: Implemented story 5-4 — place_call agent tool registration, SKILL.md creation, manifest skills field, and full test suite (10 new tests). 379 total tests passing.
- 2026-02-26: Code review fixes — removed dead plugin.placeCall stub; injected phone into first-time CALLER CONTEXT (enrollment was impossible without it); added maxLength:1000 to place_call schema; debug log for to destination; null-voiceAppUrl handler test; SKILL.md multi-user enrollment guidance. 380 total tests passing.

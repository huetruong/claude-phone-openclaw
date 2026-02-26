# Story 5.6: Identity Resolution for Outbound Callbacks

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want agents to resolve a caller's identity to a callback phone number automatically,
so that an agent can call someone back using only their canonical name — no phone number needed.

## Acceptance Criteria

1. **Given** the plugin config contains `identityLinks: { "operator": ["sip-voice:+15551234567"] }` (plugin-scoped, for outbound resolution)
   **When** the plugin starts
   **Then** the identity links are loaded and available for callback lookup, and the plugin logs `[sip-voice] loaded N identity link(s)`

2. **Given** an OpenClaw agent needs to call back user "operator"
   **When** the agent calls `place_call({ to: "operator", ... })`
   **Then** the plugin extracts the phone number `+15551234567` from the `sip-voice:` prefixed entry and places the call

3. **Given** an identity has no `sip-voice:` entry in either plugin config or session config
   **When** the plugin attempts to resolve a callback number
   **Then** the resolution returns `null` and the tool returns an error indicating no SIP callback number is configured for that identity

4. **Given** the `peerId` passed during an inbound call was dynamically enrolled via `link_identity` (Story 5.2)
   **When** the agent later needs to call back the same caller by identity name
   **Then** the agent can resolve their callback number from `session.identityLinks` without the caller needing to provide it verbally

## Tasks / Subtasks

- [x] Task 1: Add `resolveCallbackNumber()` to `identity.js` (AC: #1, #2, #3, #4)
  - [x] 1.1 Implement `resolveCallbackNumber(pluginConfig, ocConfig, identityName)` that:
    - Checks `pluginConfig.identityLinks[identityName]` for `sip-voice:` prefixed entry (operator-defined)
    - Falls back to `ocConfig.session.identityLinks[identityName]` for `sip-voice:` entry (dynamically enrolled)
    - Returns the phone number string (with `+` prefix preserved) or `null`
  - [x] 1.2 Export `resolveCallbackNumber` from `identity.js`

- [x] Task 2: Update `place_call` handler to resolve identity names (AC: #2, #3)
  - [x] 2.1 In `place_call` handler, detect if `to` is an identity name (not a phone number or extension)
    - Identity name: no `+` prefix, not all digits, not matching extension pattern
  - [x] 2.2 If identity name detected, load config and call `resolveCallbackNumber()`
  - [x] 2.3 If resolved, use the phone number for the outbound call
  - [x] 2.4 If not resolved, return `{ error: "no SIP callback number configured for identity '<name>'" }`
  - [x] 2.5 If `to` is already a phone number or extension, pass through unchanged (backward compat)

- [x] Task 3: Log identity link count on plugin startup (AC: #1)
  - [x] 3.1 In `register()`, after loading plugin config, count `identityLinks` entries and log `[sip-voice] loaded N identity link(s)`

- [x] Task 4: Update SKILL.md for identity name support (AC: #2)
  - [x] 4.1 Update `place_call` `to` parameter docs to include identity names
  - [x] 4.2 Add example of calling by identity name

- [x] Task 5: Write unit tests for `resolveCallbackNumber` (AC: #1, #2, #3, #4)
  - [x] 5.1 Test: identity in plugin config returns phone number
  - [x] 5.2 Test: identity in session config (dynamic enrollment) returns phone number
  - [x] 5.3 Test: plugin config takes precedence over session config
  - [x] 5.4 Test: identity with no sip-voice entry returns null
  - [x] 5.5 Test: unknown identity returns null
  - [x] 5.6 Test: empty/missing identityLinks returns null

- [x] Task 6: Write tests for identity resolution in `place_call` handler (AC: #2, #3)
  - [x] 6.1 Test: `to` as identity name resolves and calls outbound with phone number
  - [x] 6.2 Test: `to` as identity name not found returns error
  - [x] 6.3 Test: `to` as phone number (+15551234567) passes through unchanged
  - [x] 6.4 Test: `to` as extension (9001) passes through unchanged
  - [x] 6.5 Test: `to` as identity name in session config resolves to phone number (AC #4)

- [x] Task 7: Verify all existing tests pass (AC: all)
  - [x] 7.1 Run full test suite (`npm test`), verify all 387+ tests pass — 398 tests pass (107 CLI + 126 voice-app + 165 plugin)
  - [x] 7.2 Verify no regressions in place_call, identity, or webhook tests

## Dev Notes

### Design Context

**Current behavior:** `place_call({ to: "+15551234567", ... })` requires an explicit phone number. If an agent wants to call back "operator", it has to somehow know the phone number — there's no lookup.

**Target behavior:** `place_call({ to: "operator", ... })` detects "operator" is an identity name, resolves it to `+15551234567` via `identityLinks`, and places the call. Explicit phone numbers and extensions continue to work unchanged.

**Two identity link sources (architecture decision):**

| Source | Location | Purpose | Written by |
|--------|----------|---------|------------|
| `pluginConfig.identityLinks` | Plugin YAML config | Operator-defined static mappings | Operator manually |
| `session.identityLinks` | `openclaw.json` | Dynamic enrollment | `link_identity` tool (Story 5.2) |

Both use the same format: `name: ["sip-voice:+phone", ...]`. The reverse lookup checks plugin config first (operator-defined takes precedence), then session config.

### What Already Exists (DO NOT Recreate)

- `openclaw-plugin/src/identity.js` — `resolveIdentity(config, peerId)` for inbound phone→name resolution. **ADD `resolveCallbackNumber()` here.**
- `openclaw-plugin/src/index.js:115-144` — `place_call` tool handler. **MODIFY handler to add identity resolution.**
- `openclaw-plugin/src/outbound-client.js` — HTTP client for outbound calls. **DO NOT modify.**
- `openclaw-plugin/src/webhook-server.js` — Inbound query routing. **DO NOT modify.**
- `openclaw-plugin/src/session-store.js` — In-memory call mapping. **DO NOT modify.**
- `openclaw-plugin/skills/SKILL.md` — Agent skill document. **MODIFY to document identity name support.**
- `openclaw-plugin/test/identity.test.js` — Existing tests for `resolveIdentity` and `link_identity`. **ADD tests here for `resolveCallbackNumber`.**
- `openclaw-plugin/test/place-call-tool.test.js` — 9 existing tests for place_call. **ADD tests here for identity resolution in handler.**
- `openclaw-plugin/test/index.test.js` — 72 existing tests. **DO NOT modify.**

### What You Are Building

1. **ADD TO: `openclaw-plugin/src/identity.js`** — `resolveCallbackNumber(pluginConfig, ocConfig, identityName)` function
2. **MODIFY: `openclaw-plugin/src/index.js`** — Update `place_call` handler + add startup identity link logging
3. **MODIFY: `openclaw-plugin/skills/SKILL.md`** — Document identity name support in `to` parameter
4. **ADD TO: `openclaw-plugin/test/identity.test.js`** — Unit tests for `resolveCallbackNumber`
5. **ADD TO: `openclaw-plugin/test/place-call-tool.test.js`** — Tests for identity resolution in handler

### Exact Code Changes

**In `openclaw-plugin/src/identity.js` — Add reverse lookup:**

```js
/**
 * Resolve an identity name to a callback phone number for outbound calls.
 * Checks plugin config first (operator-defined), then session config (dynamic enrollment).
 * @param {object} pluginConfig - Plugin config (api.pluginConfig)
 * @param {object} ocConfig - Full OpenClaw config (for session.identityLinks)
 * @param {string} identityName - Canonical identity name (e.g., "operator", "hue")
 * @returns {string|null} Phone number (e.g., "+15551234567") or null if not found
 */
function resolveCallbackNumber(pluginConfig, ocConfig, identityName) {
  // Check plugin config first (operator-defined takes precedence)
  const pluginLinks = (pluginConfig && pluginConfig.identityLinks) || {};
  const pluginChannels = pluginLinks[identityName];
  if (Array.isArray(pluginChannels)) {
    for (const ch of pluginChannels) {
      if (ch.startsWith('sip-voice:')) {
        return ch.slice('sip-voice:'.length);
      }
    }
  }

  // Fall back to session config (dynamically enrolled)
  const sessionLinks = (ocConfig && ocConfig.session && ocConfig.session.identityLinks) || {};
  const sessionChannels = sessionLinks[identityName];
  if (Array.isArray(sessionChannels)) {
    for (const ch of sessionChannels) {
      if (ch.startsWith('sip-voice:')) {
        return ch.slice('sip-voice:'.length);
      }
    }
  }

  return null;
}

module.exports = { resolveIdentity, resolveCallbackNumber };
```

**In `openclaw-plugin/src/index.js` — Update `place_call` handler:**

```js
// At top of register(), after loading config — log identity link count:
const pluginLinks = pluginConfig.identityLinks || {};
const linkCount = Object.keys(pluginLinks).length;
if (linkCount > 0) {
  logger.info(`[sip-voice] loaded ${linkCount} identity link(s)`);
}
```

```js
// In place_call handler — add identity resolution before calling outboundClient:
handler: async ({ to, device, message, mode }) => {
  logger.info('place_call tool invoked', { device });

  // Resolve identity name to phone number if 'to' is not already a phone/extension
  let resolvedTo = to;
  if (to && !to.startsWith('+') && !/^\d+$/.test(to)) {
    // 'to' looks like an identity name — attempt resolution
    const ocConfig = await loadConfig();  // or however config is accessed
    const phone = resolveCallbackNumber(pluginConfig, ocConfig, to);
    if (phone) {
      logger.info('[sip-voice] identity resolved for callback', { identity: to });
      logger.debug('[sip-voice] resolved phone', { phone });
      resolvedTo = phone;
    } else {
      logger.warn('[sip-voice] no SIP callback number for identity', { identity: to });
      return { error: `no SIP callback number configured for identity '${to}'` };
    }
  }

  logger.debug('place_call destination', { to: resolvedTo });
  const result = await outboundClient.placeCall({ voiceAppUrl, to: resolvedTo, device, message, mode });
  if (result.error) {
    logger.warn('place_call failed', { error: result.error });
  } else {
    logger.info('place_call succeeded', { callId: result.callId });
  }
  return result;
},
```

**Config access pattern:** The handler needs access to both `pluginConfig` (already available in closure) and OpenClaw config. Check how `queryAgent` accesses `ocConfig` — it uses `ext.loadConfig()` via the dynamically imported `extensionAPI.js`. The same pattern should be used in the `place_call` handler. Verify the actual import/access pattern in `index.js` before implementing.

### Critical Implementation Rules

- **CommonJS only** — `module.exports`, `require()`, no `import` statements
- **Do NOT modify outbound-client.js** — It handles the HTTP call; identity resolution is upstream
- **Do NOT modify webhook-server.js** — Inbound flow is unchanged
- **Do NOT modify session-store.js** — Orthogonal to outbound identity resolution
- **Phone number format preservation** — `resolveCallbackNumber` returns the phone number exactly as stored in identityLinks (including `+` prefix). `outbound-client.js` already handles normalization.
- **Backward compatibility** — Explicit phone numbers (starting with `+` or all digits) MUST bypass identity resolution and work as before
- **Logger discipline** — Phone numbers at DEBUG only; identity names OK at INFO
- **`[sip-voice]` prefix** — All new log lines must include it
- **Identity name detection heuristic:** `to` is an identity name if it: (a) doesn't start with `+`, (b) is not all digits. This covers phone numbers (+15551234567), extensions (9001), and identity names (operator, hue).

### Testing Standards

- **Framework**: Node.js built-in `node:test` runner
- **Existing test count**: 387 (107 CLI + 126 voice-app + 154 plugin) — must not break any
- **Add tests to**: `identity.test.js` (for `resolveCallbackNumber`) and `place-call-tool.test.js` (for handler identity resolution)
- **Test patterns**: Follow existing `describe()` / `test()` structure in each file
- **Mocking**: Use `require.cache` injection pattern from existing tests for mocking `loadConfig()`

### Test Patterns to Follow

From `place-call-tool.test.js`:
```js
test('place_call - identity name resolves to phone number', async () => {
  // Setup: mock config with identityLinks, create handler
  // Call handler with to: "operator"
  // Assert: outboundClient.placeCall called with to: "+15551234567"
});
```

From `identity.test.js`:
```js
test('resolveCallbackNumber - returns phone from plugin config', () => {
  const pluginConfig = { identityLinks: { operator: ['sip-voice:+15551234567'] } };
  const result = resolveCallbackNumber(pluginConfig, {}, 'operator');
  assert.strictEqual(result, '+15551234567');
});
```

### Previous Story Learnings (from Story 5.5)

1. **387 total tests** — All must pass. Story 5.5 ended with 387 tests (107 CLI + 126 voice-app + 154 plugin).
2. **`resolveSessionSuffix`** — Exported as `plugin._resolveSessionSuffix` for test access. Follow same pattern if needed for `resolveCallbackNumber`.
3. **`createMockApi`** — Standard test helper in `index.test.js`. Use similar patterns.
4. **No new dependencies** — This story adds no npm packages.
5. **registerTool count** — Currently 2 (link_identity + place_call). This story should NOT change the count.
6. **Config access** — `queryAgent` accesses OpenClaw config via `ext.loadConfig()` from dynamically imported `extensionAPI.js`. The `place_call` handler needs the same access pattern.

### Git Intelligence

Recent commits show clean epic 5 progression:
- `e0c856f feat(story-5-5): persistent per-identity session context (#28)`
- `bf29249 feat(story-5-4): agent tools & SKILL.md (#27)`
- `7c9bf24 feat(story-5-3): dynamic greeting & call continuity (#26)`
- `2596231 feat(story-5-2): dynamic identity enrollment via link_identity tool (#25)`
- `b53259a feat(story-5-1): plugin-triggered outbound calls (#24)`

Story 5.5 modified: `openclaw-plugin/src/index.js` (added `resolveSessionSuffix`, updated `queryAgent`), `openclaw-plugin/test/index.test.js` (added 7 tests).

### What This Story Does NOT Include

- **No webhook-server.js changes** — Inbound flow unchanged
- **No session-store.js changes** — In-memory store orthogonal
- **No voice-app changes** — All changes are plugin-side only
- **No outbound-client.js changes** — HTTP client unchanged
- **No new tool registration** — `place_call` already exists, just updating its handler
- **No cross-channel response delivery** — Story 5.7 scope
- **No session file changes** — Story 5.5 scope (complete)

### Project Structure Notes

- Modified: `openclaw-plugin/src/identity.js` — Add `resolveCallbackNumber()` reverse lookup
- Modified: `openclaw-plugin/src/index.js` — Update `place_call` handler + startup logging
- Modified: `openclaw-plugin/skills/SKILL.md` — Document identity name support
- Modified: `openclaw-plugin/test/identity.test.js` — Add `resolveCallbackNumber` unit tests
- Modified: `openclaw-plugin/test/place-call-tool.test.js` — Add identity resolution handler tests
- No voice-app files modified
- No new files created
- No new npm dependencies

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.6] — Story definition and acceptance criteria (lines 784-808)
- [Source: _bmad-output/planning-artifacts/prd.md#FR20] — "resolve a caller identity via identityLinks to a callback phone number"
- [Source: _bmad-output/planning-artifacts/prd.md#FR30] — "configure identity links (user identity -> phone number) for callback resolution"
- [Source: _bmad-output/planning-artifacts/architecture.md#Identity-Enrollment-Design] — Two identity link systems (plugin config + session config)
- [Source: openclaw-plugin/src/identity.js] — Current `resolveIdentity()` inbound resolution (ADD reverse lookup here)
- [Source: openclaw-plugin/src/index.js#L115-L144] — Current `place_call` handler (MODIFY for identity resolution)
- [Source: openclaw-plugin/src/outbound-client.js] — Outbound HTTP client (DO NOT modify)
- [Source: openclaw-plugin/skills/SKILL.md] — Agent skill doc (MODIFY for identity name support)
- [Source: _bmad-output/implementation-artifacts/5-5-persistent-per-identity-session-context.md] — Previous story learnings and test count baseline

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation was straightforward following story spec.

### Completion Notes List

- Added `resolveCallbackNumber(pluginConfig, ocConfig, identityName)` to `identity.js` — checks plugin config first (operator-defined), falls back to `ocConfig.session.identityLinks` (dynamically enrolled). Returns phone number string or null.
- Updated `place_call` handler in `index.js` to detect identity names (not starting with `+`, not all-digit) and resolve via `resolveCallbackNumber`. Returns `{ error }` if identity not found. Explicit phone numbers and extensions bypass resolution unchanged.
- Added startup identity link count logging in `register()`: logs `[sip-voice] loaded N identity link(s)` when N > 0.
- Updated `SKILL.md` `to` parameter docs and added identity name call example.
- Added 6 unit tests for `resolveCallbackNumber` in `identity.test.js` (plugin config, session config, precedence, no sip-voice entry, unknown identity, empty config).
- Added 5 handler tests in `place-call-tool.test.js` (plugin resolve, session resolve, not-found error, phone passthrough, extension passthrough).
- Final test count: 398 total (107 CLI + 126 voice-app + 165 plugin), +11 new plugin tests. 0 failures. 0 lint errors.

### File List

- `openclaw-plugin/src/identity.js` — added `resolveCallbackNumber()`, exported it
- `openclaw-plugin/src/index.js` — imported `resolveCallbackNumber`, added startup logging, updated `place_call` handler
- `openclaw-plugin/skills/SKILL.md` — updated `to` param docs, added identity name example
- `openclaw-plugin/test/identity.test.js` — added 6 `resolveCallbackNumber` unit tests
- `openclaw-plugin/test/place-call-tool.test.js` — added 5 identity resolution handler tests
- `_bmad-output/implementation-artifacts/5-6-identity-resolution-outbound-callbacks.md` — story file (tasks, status, this record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated to review

## Change Log

- 2026-02-26: Implemented Story 5.6 — identity resolution for outbound callbacks. Added `resolveCallbackNumber()` function, updated `place_call` handler with identity name detection and resolution, added startup identity link count logging, updated SKILL.md, added 11 tests (398 total).

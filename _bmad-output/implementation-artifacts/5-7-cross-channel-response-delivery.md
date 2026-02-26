# Story 5.7: Cross-Channel Response Delivery

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an OpenClaw agent,
I want to detect when my response is too long or complex for voice,
so that I deliver a brief voice summary and route the full response to the user's primary channel.

## Acceptance Criteria

1. **Given** the agent's response exceeds ~40 words or contains structured data (lists, diffs, metrics, code)
   **When** the agent prepares the voice reply
   **Then** the agent speaks a brief summary (e.g. "Deployment finished. Full report in Discord.") and sends the complete response to the user's configured primary channel

2. **Given** the agent's response is concise and conversational
   **When** the agent prepares the voice reply
   **Then** the full response is spoken — no cross-channel delivery needed

3. **Given** no primary channel is configured for the user
   **When** a long response would normally be routed to the primary channel
   **Then** the agent speaks a truncated version and informs the user no text channel is configured

## Tasks / Subtasks

- [x] Task 1: Add `resolveUserChannels()` to `identity.js` (AC: #1, #3)
  - [x] 1.1 Implement `resolveUserChannels(pluginConfig, ocConfig, identityName)` that:
    - Scans `pluginConfig.identityLinks[identityName]` for non-`sip-voice:` entries (e.g., `discord:987654321`, `telegram:@hue`)
    - Falls back to `ocConfig.session.identityLinks[identityName]` for non-`sip-voice:` entries (dynamically enrolled channels)
    - Returns array of channel strings (may be empty)
    - **Mirrors `resolveCallbackNumber`** pattern (plugin config first, then session config), but extracts ALL non-SIP channels instead of one SIP phone
  - [x] 1.2 Export `resolveUserChannels` from `identity.js`

- [x] Task 2: Enrich caller context with linked text channels in `queryAgent` (AC: #1, #2, #3)
  - [x] 2.1 In `queryAgent` (index.js), after `resolveSessionSuffix`, call `resolveUserChannels(config, api.config, identityContext?.identity)` when identity is available
  - [x] 2.2 Extend the `[CALLER CONTEXT]` line in `enrichedPrompt` to include channel info:
    - Known caller with channels: `[CALLER CONTEXT: Known caller, identity="hue", textChannels=["discord:987654321"]]`
    - Known caller without channels: `[CALLER CONTEXT: Known caller, identity="hue", textChannels=none]`
    - First-time caller: unchanged (no channels available yet)
  - [x] 2.3 Import `resolveUserChannels` from `identity.js` (add to existing `require('./identity')` destructure)

- [x] Task 3: Update SKILL.md with response management section (AC: #1, #2, #3)
  - [x] 3.1 Add new `## Voice Response Management` section to SKILL.md between "Call Continuity" and "Error Handling"
  - [x] 3.2 Document the ~40 word threshold and structured data detection rule
  - [x] 3.3 Document the `🗣️ VOICE_RESPONSE:` marker: agent MUST use this marker for the voice-friendly summary when full response is too long. `extractVoiceLine()` in voice-app (conversation-loop.js:77) already extracts this marker.
  - [x] 3.4 Document the three behavior modes:
    - **Short response** (≤~40 words, no structured data): speak full response — no marker needed
    - **Long response + user has textChannels**: use `🗣️ VOICE_RESPONSE:` marker with brief summary, include reference to primary channel (e.g., "Full report sent to Discord."). Full response naturally goes to the OpenClaw session for primary channel delivery.
    - **Long response + no textChannels**: use `🗣️ VOICE_RESPONSE:` marker with best-effort truncated summary, inform user no text channel is configured
  - [x] 3.5 Add examples for each mode

- [x] Task 4: Write unit tests for `resolveUserChannels` (AC: #1, #3)
  - [x] 4.1 Test: identity with discord and telegram channels returns both (from plugin config)
  - [x] 4.2 Test: identity with discord channel in session config (dynamic enrollment) returns it
  - [x] 4.3 Test: plugin config channels take precedence — uses plugin config channels, ignores session config
  - [x] 4.4 Test: identity with only sip-voice entries returns empty array
  - [x] 4.5 Test: unknown identity returns empty array
  - [x] 4.6 Test: empty/missing identityLinks returns empty array
  - [x] 4.7 Test: mixed sip-voice and non-sip-voice entries — only non-sip-voice returned

- [x] Task 5: Write integration tests for channel-enriched caller context (AC: #1, #2, #3)
  - [x] 5.1 Test: `queryAgent` with enrolled identity and channels passes `textChannels=["discord:987654321"]` in enriched prompt to `runEmbeddedPiAgent`
  - [x] 5.2 Test: `queryAgent` with enrolled identity and NO channels passes `textChannels=none` in enriched prompt
  - [x] 5.3 Test: `queryAgent` with first-time caller does NOT include textChannels in enriched prompt
  - [x] 5.4 Use `setupQueryAgentEnv()` helper from existing `index.test.js` integration tests (Story 5.5 review added this)

- [x] Task 6: Verify all existing tests pass (AC: all)
  - [x] 6.1 Run full test suite (`npm test`), verify all 407+ tests pass (107 CLI + 126 voice-app + 174 plugin)
  - [x] 6.2 Verify no regressions in webhook, identity, or index tests

## Dev Notes

### Design Context

**Current behavior:** Agent responses come back as plain text. `conversation-loop.js` extracts a voice-friendly line via `extractVoiceLine()` (line 77) and discards the rest. If the agent writes a 200-word analysis, the user hears only the first sentence. No way for the agent to know about the user's other channels, so no intelligent medium selection.

**Target behavior:** The enriched prompt tells the agent what text channels the user has linked. SKILL.md instructs the agent to:
- Format short responses normally (spoken in full)
- Format long responses with `🗣️ VOICE_RESPONSE:` marker (spoken as voice summary) while posting full content to primary channel
- Handle the no-channel case gracefully

**Key insight:** This is primarily an **agent behavior** story, not an infrastructure story. The pipeline already supports voice line extraction (`extractVoiceLine`), and OpenClaw agents running via `runEmbeddedPiAgent` have access to all registered tools including those from other channel plugins. The missing pieces are: (1) agent doesn't know what channels the user has, and (2) SKILL.md doesn't instruct on medium selection.

**Cross-channel delivery mechanism:** OpenClaw is a multi-channel agent system. When the agent runs via `runEmbeddedPiAgent`, it operates within the OpenClaw session infrastructure. The agent's primary response goes back to the voice channel (via payloads → plugin → voice-app). For cross-channel delivery, the agent uses OpenClaw's session messaging — the same way any agent posts to a user's DM in Discord or Telegram. The SIP voice plugin provides channel awareness; OpenClaw core handles the routing.

### What Already Exists (DO NOT Recreate)

- `voice-app/lib/conversation-loop.js:77-127` — `extractVoiceLine(response)` extracts voice-friendly text. Priority: `🗣️ VOICE_RESPONSE:` marker (≤60 words) → `🗣️ CUSTOM COMPLETED:` (≤50 words) → `🎯 COMPLETED:` → first sentence / 500 chars. **DO NOT modify.**
- `voice-app/lib/conversation-loop.js:518-523` — Voice line played via TTS, full response discarded. **DO NOT modify.**
- `openclaw-plugin/src/identity.js` — Has `resolveIdentity()` and `resolveCallbackNumber()`. **ADD `resolveUserChannels()` here.**
- `openclaw-plugin/src/index.js:195-227` — `queryAgent` with enriched prompt including `[CALLER CONTEXT]`. **MODIFY enriched prompt to include channels.**
- `openclaw-plugin/src/index.js:12` — Already imports `{ resolveIdentity, createLinkIdentityHandler, resolveCallbackNumber }` from identity.js. **ADD `resolveUserChannels` to destructure.**
- `openclaw-plugin/skills/SKILL.md` — Current sections: place_call, link_identity, Call Continuity, Error Handling. **ADD Voice Response Management section.**
- `openclaw-plugin/test/identity.test.js` — Existing tests for resolveIdentity and resolveCallbackNumber. **ADD tests for resolveUserChannels.**
- `openclaw-plugin/test/index.test.js:456-540` — Integration tests with `setupQueryAgentEnv()` helper (captures queryAgent and mocks extensionAPI). **ADD tests for channel-enriched prompt.**

### What You Are Building

1. **ADD TO: `openclaw-plugin/src/identity.js`** — `resolveUserChannels()` function
2. **MODIFY: `openclaw-plugin/src/index.js`** — Import `resolveUserChannels`, update enriched prompt in `queryAgent`
3. **MODIFY: `openclaw-plugin/skills/SKILL.md`** — Add Voice Response Management section
4. **ADD TO: `openclaw-plugin/test/identity.test.js`** — Unit tests for `resolveUserChannels`
5. **ADD TO: `openclaw-plugin/test/index.test.js`** — Integration tests for channel-enriched caller context

### Exact Code Changes

**In `openclaw-plugin/src/identity.js` — Add channel resolution:**

```js
/**
 * Resolve all non-SIP text channels linked to an identity.
 * Checks plugin config first (operator-defined), then session config (dynamic enrollment).
 * @param {object} pluginConfig - Plugin config (api.pluginConfig)
 * @param {object} ocConfig - Full OpenClaw config (for session.identityLinks)
 * @param {string} identityName - Canonical identity name (e.g., "hue")
 * @returns {string[]} Array of channel strings (e.g., ["discord:987654321"]) — empty if none
 */
function resolveUserChannels(pluginConfig, ocConfig, identityName) {
  if (!identityName) return [];

  // Check plugin config first (operator-defined takes precedence)
  const pluginLinks = (pluginConfig && pluginConfig.identityLinks) || {};
  const pluginChannels = pluginLinks[identityName];
  if (Array.isArray(pluginChannels)) {
    const textChannels = pluginChannels.filter(ch => !ch.startsWith('sip-voice:'));
    if (textChannels.length > 0) return textChannels;
  }

  // Fall back to session config (dynamically enrolled)
  const sessionLinks = (ocConfig && ocConfig.session && ocConfig.session.identityLinks) || {};
  const sessionChannels = sessionLinks[identityName];
  if (Array.isArray(sessionChannels)) {
    const textChannels = sessionChannels.filter(ch => !ch.startsWith('sip-voice:'));
    if (textChannels.length > 0) return textChannels;
  }

  return [];
}
```

**In `openclaw-plugin/src/index.js` — Update import and enriched prompt:**

```js
// Line 12 — add resolveUserChannels to existing destructure:
const { resolveIdentity, createLinkIdentityHandler, resolveCallbackNumber, resolveUserChannels } = require('./identity');
```

```js
// In queryAgent, AFTER resolveSessionSuffix, BEFORE enrichedPrompt:
const userChannels = (identityContext && identityContext.identity)
  ? resolveUserChannels(config, api.config, identityContext.identity)
  : [];
const channelInfo = userChannels.length > 0
  ? `textChannels=${JSON.stringify(userChannels)}`
  : 'textChannels=none';

// Update ctxLine for known callers to include channelInfo:
let enrichedPrompt = prompt;
if (identityContext) {
  const ctxLine = identityContext.isFirstCall
    ? `[CALLER CONTEXT: First-time caller, no identity on file${peerId ? `, phone="${peerId}"` : ''}]`
    : `[CALLER CONTEXT: Known caller, identity="${identityContext.identity}", ${channelInfo}]`;
  enrichedPrompt = ctxLine + '\n' + prompt;
}
```

**In `openclaw-plugin/skills/SKILL.md` — Add section between Call Continuity and Error Handling:**

```markdown
## Voice Response Management

Voice is low-bandwidth — optimize your responses for spoken delivery.

### Rules

1. **Short response** (≤~40 words, no structured data): Speak the full response. No special formatting needed.
2. **Long response + user has textChannels**: Prefix your voice summary with `🗣️ VOICE_RESPONSE:` and mention where the full output went.
   Example: `🗣️ VOICE_RESPONSE: Deployment complete, three services updated. Full report sent to your Discord.`
3. **Long response + no textChannels** (`textChannels=none`): Prefix a best-effort truncated summary with `🗣️ VOICE_RESPONSE:` and inform the user.
   Example: `🗣️ VOICE_RESPONSE: Deployment complete with three service updates. I have more detail, but you don't have a text channel linked. Say "link identity" to add one.`

### What counts as "long or complex"

- More than ~40 words
- Contains lists, tables, diffs, code, metrics, or URLs
- Contains markdown formatting the caller can't hear

### Examples

**Short — speak fully:**
```
The server is healthy. CPU at 12%, memory at 45%.
```

**Long — with text channels:**
```
🗣️ VOICE_RESPONSE: Your research task is done. I found 3 papers and posted the full summary with links to your Discord.

[Full detailed response with markdown, links, citations...]
```

**Long — no text channels:**
```
🗣️ VOICE_RESPONSE: Your research task is done. I found 3 relevant papers. I can't send the details since you don't have a text channel linked — say "link identity" to add Discord or another channel.
```
```

### Critical Implementation Rules

- **CommonJS only** — `module.exports`, `require()`, no `import` statements
- **Do NOT modify conversation-loop.js** — `extractVoiceLine()` already handles `🗣️ VOICE_RESPONSE:` extraction. The voice-app side needs zero changes.
- **Do NOT modify webhook-server.js** — Inbound flow unchanged
- **Do NOT modify session-store.js** — Orthogonal to cross-channel delivery
- **Do NOT modify outbound-client.js** — Voice call placement unchanged
- **Logger discipline** — Phone numbers at DEBUG only; channel identifiers OK at INFO
- **`[sip-voice]` prefix** — All new log lines must include it
- **`resolveUserChannels` mirrors `resolveCallbackNumber`** — Same two-source lookup pattern (plugin config first, session config fallback), different filter (non-SIP channels vs SIP channel)
- **Empty channels = `textChannels=none`** — Not omitted from context; the agent needs to know channels are absent to trigger AC #3 behavior
- **First-time callers get no channel info** — They have no identity yet, so no identity links to resolve

### Testing Standards

- **Framework**: Node.js built-in `node:test` runner
- **Existing test count**: 407 (107 CLI + 126 voice-app + 174 plugin) — must not break any
- **Add tests to**: `identity.test.js` (for `resolveUserChannels`) and `index.test.js` (for enriched prompt integration)
- **Integration tests**: Use `setupQueryAgentEnv()` helper from existing `index.test.js` (added in Story 5.5 review) — inject mock extensionAPI, capture `queryAgent`, call it with different identity contexts, assert the `prompt` passed to `runEmbeddedPiAgent` contains correct channel info

### Test Patterns to Follow

From `identity.test.js` (resolveCallbackNumber tests):
```js
test('resolveUserChannels - returns non-sip channels from plugin config', () => {
  const pluginConfig = { identityLinks: { hue: ['sip-voice:+15551234567', 'discord:987654321'] } };
  const result = resolveUserChannels(pluginConfig, {}, 'hue');
  assert.deepStrictEqual(result, ['discord:987654321']);
});
```

From `index.test.js` (Task 4.1-4.5 pattern):
```js
test('index - queryAgent (integration): known caller with channels includes textChannels in prompt', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    // Need to set up mock config with identity links containing channels
    await capturedQueryAgent('morpheus', 'call-uuid', 'hello', '+15551234567', { identity: 'hue', isFirstCall: false });
    const prompt = runCalls[0].prompt;
    assert.ok(prompt.includes('textChannels='), 'enriched prompt must include textChannels');
  } finally {
    await cleanup();
  }
});
```

**Note on integration test mocking:** `setupQueryAgentEnv()` creates a mock `api` with empty `config: {}`. For tests that verify channel resolution, you'll need to extend `createMockApi()` or the `setupQueryAgentEnv()` helper to inject `identityLinks` into `api.config.session.identityLinks` so `resolveUserChannels` can find them. Alternative: inject `identityLinks` into the `pluginConfig` parameter since that's checked first.

### Previous Story Learnings (from Story 5.6)

1. **400 total tests** → now 407 after 5.5 code review. All must pass.
2. **`resolveCallbackNumber`** — Two-source lookup pattern: plugin config first, session config fallback. `resolveUserChannels` follows the same pattern.
3. **Identity name detection** — In `place_call` handler: no `+` prefix and not all digits = identity name. Not relevant for this story but demonstrates the detection pattern.
4. **`require.cache` injection** — Used for mocking modules in tests. Follow same pattern for `setupQueryAgentEnv` extension.
5. **Config access in `queryAgent`** — `api.config` is available in closure (set in `register()`). Used for `resolveCallbackNumber` resolution. Same access pattern for `resolveUserChannels`.
6. **SKILL.md** — Located at `openclaw-plugin/skills/SKILL.md`, loaded via `"skills": ["./skills"]` in manifest. Add new section between "Call Continuity" and "Error Handling".

### Git Intelligence

Recent commits show clean epic 5 progression:
- `c9b7cc4 review(story-5-5): adversarial code review fixes (#30)`
- `84d8ae9 feat(story-5-6): identity resolution for outbound callbacks (#29)`
- `e0c856f feat(story-5-5): persistent per-identity session context (#28)`
- `bf29249 feat(story-5-4): agent tools & SKILL.md (#27)`
- `7c9bf24 feat(story-5-3): dynamic greeting & call continuity (#26)`
- `2596231 feat(story-5-2): dynamic identity enrollment via link_identity tool (#25)`
- `b53259a feat(story-5-1): plugin-triggered outbound calls (#24)`

Story 5.6 modified: `identity.js` (added `resolveCallbackNumber`), `index.js` (updated `place_call` + startup logging), `SKILL.md`, `identity.test.js`, `place-call-tool.test.js`.

### What This Story Does NOT Include

- **No voice-app changes** — `extractVoiceLine()` already handles `🗣️ VOICE_RESPONSE:` marker extraction. No conversation-loop changes needed.
- **No openclaw-bridge.js changes** — Bridge HTTP contract unchanged
- **No webhook-server.js changes** — Inbound flow unchanged
- **No session-store.js changes** — Orthogonal
- **No outbound-client.js changes** — Voice call placement unchanged
- **No new tools** — No `send_to_channel` tool. The agent uses OpenClaw's native session messaging for cross-channel delivery. The plugin's job is channel awareness, not message routing.
- **No new npm dependencies**
- **No new files** — Only modifying existing files

### Project Structure Notes

- Modified: `openclaw-plugin/src/identity.js` — Add `resolveUserChannels()` function
- Modified: `openclaw-plugin/src/index.js` — Import `resolveUserChannels`, enrich caller context with channel info
- Modified: `openclaw-plugin/skills/SKILL.md` — Add Voice Response Management section
- Modified: `openclaw-plugin/test/identity.test.js` — Add `resolveUserChannels` unit tests
- Modified: `openclaw-plugin/test/index.test.js` — Add channel-enriched prompt integration tests
- No voice-app files modified
- No new files created
- No new npm dependencies

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.7] — Story definition: cross-channel response delivery (FR33)
- [Source: _bmad-output/planning-artifacts/prd.md#FR33] — "When the agent response is too long for voice delivery, deliver concise spoken summary and route full text to primary channel"
- [Source: _bmad-output/planning-artifacts/architecture.md#Identity-Enrollment-Design] — Two identity link systems (plugin config + session config), channel format `["sip-voice:+phone", "discord:id"]`
- [Source: voice-app/lib/conversation-loop.js#L77-L127] — `extractVoiceLine()` with `🗣️ VOICE_RESPONSE:` marker support (DO NOT modify)
- [Source: voice-app/lib/conversation-loop.js#L518-L523] — Voice line extraction and TTS playback (DO NOT modify)
- [Source: openclaw-plugin/src/identity.js] — Current `resolveIdentity()` and `resolveCallbackNumber()` (ADD `resolveUserChannels` here)
- [Source: openclaw-plugin/src/index.js#L195-L208] — Current enriched prompt construction in `queryAgent` (MODIFY to include channels)
- [Source: openclaw-plugin/src/index.js#L12] — Current identity.js imports (ADD `resolveUserChannels`)
- [Source: openclaw-plugin/skills/SKILL.md] — Current SKILL.md sections (ADD Voice Response Management)
- [Source: openclaw-plugin/test/index.test.js#L460-L540] — `setupQueryAgentEnv()` integration test helper (REUSE for channel tests)
- [Source: _bmad-output/implementation-artifacts/5-6-identity-resolution-outbound-callbacks.md] — Previous story learnings and test patterns

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Added `resolveUserChannels(pluginConfig, ocConfig, identityName)` to `identity.js` — mirrors `resolveCallbackNumber` pattern exactly (plugin config first, session config fallback), but filters for non-SIP channels instead of SIP phone numbers.
- Updated `queryAgent` in `index.js`: moved `resolveSessionSuffix` before enrichedPrompt construction; added `resolveUserChannels` call; known callers now receive `textChannels=[...]` or `textChannels=none` in `[CALLER CONTEXT]`; first-time callers unchanged.
- Updated `Call Continuity` section in SKILL.md to reflect new context format with `textChannels`.
- Added `## Voice Response Management` section to SKILL.md with all three behavior modes, threshold definition, and examples.
- Extended `setupQueryAgentEnv()` to accept `opts.pluginConfig` for injection — backward compatible, all existing tests pass.
- 7 unit tests for `resolveUserChannels` + 3 integration tests for channel-enriched prompt; total test count 417 (up from 407), all passing.

### File List

- `openclaw-plugin/src/identity.js` — Added `resolveUserChannels()` function and exported it
- `openclaw-plugin/src/index.js` — Added `resolveUserChannels` import; restructured `queryAgent` to call `resolveSessionSuffix` first, then resolve channels, then build enriched prompt with `textChannels` info
- `openclaw-plugin/skills/SKILL.md` — Updated `Call Continuity` section to show new context format; added `## Voice Response Management` section
- `openclaw-plugin/test/identity.test.js` — Added 7 unit tests for `resolveUserChannels` (Tasks 4.1–4.7)
- `openclaw-plugin/test/index.test.js` — Extended `setupQueryAgentEnv()` to accept `opts`; added 3 integration tests for channel-enriched prompt (Tasks 5.1–5.3)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Updated `5-7-cross-channel-response-delivery` status to `review`

## Change Log

- 2026-02-26: Implemented Story 5.7 — cross-channel response delivery. Added `resolveUserChannels()` to identity.js; enriched `[CALLER CONTEXT]` in queryAgent with `textChannels` info; added Voice Response Management section to SKILL.md; 10 new tests (417 total, all pass).
- 2026-02-26: Code review fixes — clarified SKILL.md Rule 2 to explicitly instruct agents to include full response body after `🗣️ VOICE_RESPONSE:` marker; guarded channelInfo computation inside identityContext branch (L3); added test 4.8 for SIP-only plugin config falling through to session discord (L1); strengthened integration tests 5.1–5.3 to assert exact CALLER CONTEXT line format (L2); added sprint-status.yaml to File List (M1). 418 total tests, all pass.

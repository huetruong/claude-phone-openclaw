# Deployment Retrospective — 2026-02-24

## Scope

First end-to-end deployment of the OpenClaw SIP Voice Plugin across two machines:
- **vitalpbx-server** — FreePBX + voice-app (extensions 9000/9002)
- **openclaw-gateway** — OpenClaw gateway (agents: `morpheus`, `cephanie`)

## Outcome

✅ Full end-to-end working: SIP calls to ext 9000 (morpheus agent) and ext 9002 (cephanie agent) both respond correctly.

---

## Issues Discovered During Deployment

### Issue 1: `package.json` missing `openclaw.extensions`

**Symptom:** OpenClaw installed the plugin but did not load `src/index.js`.

**Root cause:** Plugin discovery requires `"openclaw": { "extensions": ["./src/index.js"] }` in `package.json`. This is separate from the `"main"` field (which is for npm, not OpenClaw).

**Fix:** Added to `package.json`:
```json
"openclaw": {
  "extensions": ["./src/index.js"]
}
```

**Lesson:** Both `"main"` and `"openclaw.extensions"` are required. `"main"` is for `require('openclaw-sip-voice')`. `"openclaw.extensions"` is how the OpenClaw loader discovers plugin entry points.

---

### Issue 2: `api.getConfig is not a function` — Wrong Plugin API Shape

**Symptom:** Gateway error on startup: `TypeError: api.getConfig is not a function`.

**Root cause:** The entire plugin was implemented against an incorrect understanding of the OpenClaw plugin SDK. The Dev Notes for Story 1.1 specified `async activate(api)` with `api.getConfig()` and `api.registerChannel()` — none of these match the actual SDK.

**Actual OpenClaw SDK shape (v2026.2.21):**

| Property | Type | Description |
|---|---|---|
| `api.pluginConfig` | `Record<string, unknown>` | Plugin config (property, not method) |
| `api.config` | `OpenClawConfig` | Full system config |
| `api.runtime` | `PluginRuntime` | Channel/infra helpers (no agent invocation) |

**Actual registration methods:**
- `api.registerService({ id, start, stop })` — background service lifecycle (our pattern)
- `api.registerChannel({ plugin })` — full channel plugin (Discord/Telegram pattern, NOT ours)
- `api.registerGatewayMethod(name, handler)` — gateway RPC
- `api.registerTool(tool)`, `api.registerHook(events, handler)`, etc.

**Plugin entry point shape:**
```js
const plugin = {
  id: 'openclaw-sip-voice',   // must match plugins.entries key in openclaw.json
  name: 'SIP Voice',
  description: '...',
  register(api) {              // synchronous — must return undefined, NOT a Promise
    const config = api.pluginConfig || {};
    api.registerService({ ... });
  },
};
module.exports = plugin;
```

**Why `api.registerChannel()` is wrong for us:** `registerChannel()` expects a complete `ChannelPlugin` interface including `outbound.sendText`, `config` adapters, and `capabilities` object. It's designed for Discord/Telegram-style channel plugins. Our plugin is a webhook bridge — it just needs a background HTTP server, which is exactly what `registerService()` provides.

**Fix:** Complete rewrite of `src/index.js`. See Story 1.1 Post-Deployment Findings.

---

### Issue 3: Plugin ID mismatch

**Symptom:** OpenClaw warning: `config uses "openclaw-sip-voice", export uses "sip-voice"`.

**Root cause:** `plugin.id` in `index.js` was `'sip-voice'` but openclaw.json `plugins.entries` key was `'openclaw-sip-voice'`.

**Fix:** Changed `plugin.id` to `'openclaw-sip-voice'` to match the config key.

**Lesson:** The `plugin.id` field in the exported object must exactly match the key under `plugins.entries` in openclaw.json.

---

### Issue 4: `plugins.allow` trust warning

**Symptom:** Gateway started but logged warnings about untrusted plugin on every load.

**Root cause:** Non-bundled plugins require explicit trust via `plugins.allow` in openclaw.json.

**Fix:** Added to openclaw.json:
```json
"plugins": {
  "allow": ["openclaw-sip-voice"],
  ...
}
```

---

### Issue 5: Double timestamp in logs

**Symptom:** Log lines showed two timestamps: `[2026-02-24T12:00:00.000Z] INFO [sip-voice] message` in journald output that itself already prefixes with `Feb 24 12:00:00`.

**Root cause:** `logger.js` `formatMessage()` prepended `new Date().toISOString()`, and systemd journald adds its own timestamp.

**Fix:** Removed timestamp from `formatMessage()`. Logs now: `INFO [sip-voice] message`.

**Lesson:** When running under systemd/journald, never add timestamps in application logger — the journal handles it.

---

### Issue 6: `store.includes is not a function` — Wrong `resolveStorePath` signature

**Symptom:** Runtime error when first query arrived: `TypeError: store.includes is not a function`.

**Root cause:** Called `resolveStorePath(ocConfig)` passing the full OpenClaw config object. The actual signature is `resolveStorePath(store?: string)` — it takes an optional path string, not a config object.

**Actual function signatures (from `core-bridge.ts`):**
```typescript
resolveStorePath(store?: string, opts?: { agentId?: string }) => string
// store = the string value of ocConfig?.session?.store — NOT the config object itself

ensureAgentWorkspace(params?: { dir: string }) => Promise<void>
// params.dir = the resolved workspace directory string — NOT (config, agentId)

resolveAgentDir(cfg: CoreConfig, agentId: string) => string
resolveAgentWorkspaceDir(cfg: CoreConfig, agentId: string) => string
// CoreConfig = { session?: { store?: string }, [key: string]: unknown }
// api.config (OpenClawConfig) satisfies this shape
```

**Fix:**
```js
// BEFORE (wrong):
const storePath = ext.resolveStorePath(ocConfig);
await ext.ensureAgentWorkspace(ocConfig, agentId);

// AFTER (correct):
const storePath = path.dirname(ext.resolveStorePath(ocConfig?.session?.store));
await ext.ensureAgentWorkspace({ dir: workspaceDir });
```

---

### Issue 7: `ENOTDIR: not a directory .../sessions.json/sip-voice`

**Symptom:** Error trying to `mkdir` inside `sessions.json` — treating a file as a directory.

**Root cause:** `resolveStorePath()` returns the full path to the `sessions.json` FILE, not a directory. We were passing it directly to `path.join(storePath, 'sip-voice', ...)`, which created a path like `.../sessions.json/sip-voice/agent-callid.jsonl`.

**Fix:** Wrap with `path.dirname()`:
```js
// BEFORE (wrong):
const storePath = ext.resolveStorePath(ocConfig?.session?.store);

// AFTER (correct):
const storePath = path.dirname(ext.resolveStorePath(ocConfig?.session?.store));
// resolveStorePath returns .../sessions.json
// path.dirname gives us .../  (the sessions directory)
```

---

## Additional Changes During Deployment

### CLI Bridge Support (Part 1 of deploy plan)

Added OpenClaw bridge configuration to the CLI setup wizard (`cli/lib/commands/setup.js` and `cli/lib/docker.js`). New `setupBridge()` function prompts for:
- Bridge type (`claude` or `openclaw`)
- If `openclaw`: webhook URL and API key

New env vars written to `.env`:
```
BRIDGE_TYPE=openclaw
OPENCLAW_WEBHOOK_URL=http://<openclaw-gateway>:47334
OPENCLAW_API_KEY=<shared-secret>
```

### `docs/openclaw-plugin-architecture.md` created

Comprehensive reference document for OpenClaw plugin development, covering:
- Plugin discovery and loading mechanism
- Required files (`package.json` + `openclaw.plugin.json` + `openclaw.extensions`)
- Complete `api` surface (all registration methods)
- Two plugin patterns: Channel (Discord/Slack) vs Service (our pattern)
- Agent interaction via `runEmbeddedPiAgent()` from `dist/extensionAPI.js`
- Correct function signatures for `resolveStorePath`, `ensureAgentWorkspace`, etc.
- Stock plugin inventory for reference

---

## What the Docs Had Wrong

The original architecture document and story Dev Notes contained several incorrect assumptions about the OpenClaw API, likely based on outdated or inferred documentation:

| Incorrect Assumption | Reality |
|---|---|
| Entry point: `async activate(api)` | Entry point: sync `register(api)` returning undefined |
| Config: `api.getConfig()` method | Config: `api.pluginConfig` property |
| Registration: `api.registerChannel({ id, name })` | Registration: `api.registerService({ id, start, stop })` |
| `api.runtime` can invoke agents | `api.runtime` is channel/infra only — no agent invocation |
| `resolveStorePath(config)` takes config object | `resolveStorePath(store?: string)` takes string |
| `ensureAgentWorkspace(config, agentId)` | `ensureAgentWorkspace({ dir: string })` |
| Logger should include ISO timestamp | No timestamp — journald handles it |
| `package.json "main"` is sufficient | Also need `"openclaw": { "extensions": [...] }` |

---

## Test Results After All Fixes

```
216 tests passing (96 cli + 30 voice-app + 90 plugin)
0 lint errors
```

---

## End-to-End Test Results

| Test | Command | Result |
|---|---|---|
| Plugin health | `GET /voice/health` | `{"ok":true}` ✅ |
| Dewey agent curl | `POST /voice/query accountId=dewey` | `{"response":"Hey there, Huey! 🦆"}` ✅ |
| Cephanie agent curl | `POST /voice/query accountId=cephanie` | `{"response":"Hello! Cephanie here, ready to help."}` ✅ |
| SIP call ext 9000 | Dial 9000 → morpheus agent responds | ✅ |
| SIP call ext 9002 | Dial 9002 → cephanie agent responds | ✅ |

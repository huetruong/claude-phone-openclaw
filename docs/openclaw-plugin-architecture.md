# OpenClaw Plugin Architecture Reference

Reference for developing OpenClaw plugins, based on analysis of OpenClaw 2026.2.21 source code and [official docs](https://docs.openclaw.ai/plugins).

## Plugin Discovery & Loading

OpenClaw scans for plugins in order: config paths > workspace extensions > global extensions > bundled extensions. First match wins.

Non-bundled plugins require explicit trust via `plugins.allow` in openclaw config, or a warning is emitted on startup.

The loader uses [jiti](https://github.com/nicolo-ribaudo/jiti) (just-in-time TypeScript/ESM transpiler), so `.ts`, `.js`, `.mjs`, `.cjs` all work. CommonJS `module.exports` is auto-wrapped via `interopDefault: true`.

### Module Resolution

The loader resolves exports via `resolvePluginModuleExport()`:

```js
// Accepts three shapes:
// 1. Default export object with register/activate method
// 2. Plain function (treated as register function)
// 3. CommonJS module.exports object (jiti wraps as { default: exports })

function resolvePluginModuleExport(moduleExport) {
    const resolved = moduleExport?.default ?? moduleExport;
    if (typeof resolved === "function") return { register: resolved };
    if (resolved && typeof resolved === "object") {
        return {
            definition: resolved,
            register: resolved.register ?? resolved.activate
        };
    }
    return {};
}
```

**Both `register` and `activate` work** — `register` takes priority if both exist.

## Required Files

### `package.json`

Must include `openclaw.extensions` array pointing to entry file(s):

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "openclaw": {
    "extensions": ["./src/index.js"]
  }
}
```

### `openclaw.plugin.json` (Manifest)

Required for all plugins. Enables discovery and validation without executing code.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What it does",
  "configSchema": {
    "type": "object",
    "properties": {
      "port": { "type": "number", "default": 47334 },
      "apiKey": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

**Every plugin must ship a JSON Schema**, even if it accepts no config:

```json
{ "configSchema": { "type": "object", "additionalProperties": false } }
```

Optional manifest fields: `kind`, `channels`, `providers`, `skills`, `version`, `uiHints`.

## Plugin Entry Point

Standard pattern used by all bundled plugins:

```js
const plugin = {
    id: 'my-plugin',
    name: 'My Plugin',
    description: 'Description',
    register(api) {
        const config = api.pluginConfig || {};
        // Registration calls here (must be synchronous)
    },
};

module.exports = plugin;
// or: export default plugin;
```

**Important**: If `register()` returns a Promise, the loader logs a warning and ignores the async result. Registration must be synchronous — use `api.registerService()` for async startup work.

## Plugin API Surface (`api`)

### Properties

| Property | Type | Description |
|---|---|---|
| `api.id` | `string` | Plugin ID |
| `api.config` | `OpenClawConfig` | Full system config |
| `api.pluginConfig` | `Record<string, unknown>` | Plugin-specific config (from `plugins.entries.<id>.config`) |
| `api.runtime` | `PluginRuntime` | Runtime helpers (TTS, media, routing, sessions) |
| `api.logger` | `PluginLogger` | Logger with `.debug()`, `.info()`, `.warn()`, `.error()` |

### Registration Methods

| Method | Purpose |
|---|---|
| `api.registerChannel({ plugin })` | Register a full ChannelPlugin (chat channels) |
| `api.registerService({ id, start, stop })` | Background service lifecycle |
| `api.registerGatewayMethod(name, handler)` | Gateway RPC method |
| `api.registerTool(tool, opts?)` | Agent-accessible tool |
| `api.registerHook(events, handler, opts?)` | Lifecycle event hooks |
| `api.registerHttpHandler(handler)` | Raw HTTP handler |
| `api.registerHttpRoute({ path, handler })` | Path-based HTTP route |
| `api.registerCli(registrar, opts?)` | CLI subcommands |
| `api.registerProvider(provider)` | Model provider (OAuth/API key) |
| `api.registerCommand({ name, description, handler })` | Chat command (bypasses LLM) |
| `api.on(hookName, handler)` | Typed lifecycle hook |
| `api.resolvePath(input)` | Resolve user-relative paths |

## Two Plugin Patterns

### Pattern 1: Channel Plugin (discord, telegram, slack)

For full chat-style messaging channels. Implements the `ChannelPlugin` interface:

```js
register(api) {
    api.registerChannel({
        plugin: {
            id: 'my-channel',
            meta: { label: 'My Channel', docsPath: '/channels/my-channel' },
            capabilities: { /* supported features */ },
            config: { /* account resolution adapters */ },
            outbound: {
                deliveryMode: 'direct',
                sendText: async (account, target, text) => ({ ok: true }),
            },
            // Optional: setup, pairing, security, groups, mentions,
            //           status, gateway, streaming, threading, messaging,
            //           directory, resolver, actions, heartbeat, agentTools
        }
    });
}
```

**Required adapters**: `id`, `meta`, `capabilities`, `config`, `outbound.sendText`.

### Pattern 2: Service Plugin (voice-call — our pattern)

For webhook-based bridges, background services, and tool providers. Does NOT use `registerChannel()`:

```js
register(api) {
    const config = api.pluginConfig || {};

    // Gateway RPC methods (for external HTTP calls)
    api.registerGatewayMethod('myplugin.query', async ({ params, respond }) => {
        // handle request
        respond({ result: 'ok' });
    });

    // Background service (async start/stop)
    api.registerService({
        id: 'my-service',
        start: async () => { /* start webhook server */ },
        stop: async () => { /* graceful shutdown */ },
    });

    // Agent tools (optional)
    api.registerTool({ name: 'my_tool', schema: { /* TypeBox */ }, handler: async () => {} });

    // CLI commands (optional)
    api.registerCli((program) => { program.command('mycommand').action(() => {}) });
}
```

## Agent Interaction

### Embedded Pi Agent (voice-call pattern)

The voice-call plugin uses `runEmbeddedPiAgent()` from OpenClaw core — an in-process agent invocation:

```js
import { loadExtensionAPI } from 'openclaw/dist/extensionAPI.js';
const { runEmbeddedPiAgent } = loadExtensionAPI();

const result = await runEmbeddedPiAgent({
    model: 'openai/gpt-4o-mini',
    systemPrompt: '...',
    message: userTranscript,
    sessionKey: `voice:${phoneNumber}`,
    lane: 'voice',
    timeout: 30000,
});
```

### External Webhook (our pattern)

For two-server deployment, the plugin receives HTTP requests from the voice-app and routes to named agents in-process using `runEmbeddedPiAgent` from `dist/extensionAPI.js`.

**Key finding**: `api.runtime` has NO agent invocation method. `PluginRuntime` is entirely channel/infra-oriented (TTS, media, routing helpers for channel plugins). Agent invocation requires dynamic import of `dist/extensionAPI.js`.

```js
// Find and load extensionAPI.js (ESM — must use dynamic import)
const candidates = (require.resolve.paths('openclaw') || []).map(
  p => path.join(p, 'openclaw', 'dist', 'extensionAPI.js')
);
// Also try: execSync('npm root -g') + '/openclaw/dist/extensionAPI.js'
const ext = await import(pathToFileURL(apiPath).href);

// Exports from extensionAPI.js (verified on openclaw 2026.2.21):
// runEmbeddedPiAgent, resolveAgentDir, resolveAgentWorkspaceDir,
// resolveStorePath, resolveSessionFilePath, resolveAgentIdentity,
// resolveAgentTimeoutMs, resolveThinkingDefault, ensureAgentWorkspace,
// loadSessionStore, saveSessionStore, DEFAULT_MODEL, DEFAULT_PROVIDER

// Run a named agent in-process:
const result = await ext.runEmbeddedPiAgent({
  sessionId,              // string — UUID scoping this conversation turn
  sessionKey,             // string — e.g. 'sip-voice:morpheus:${callId}'
  messageProvider,        // string — e.g. 'sip-voice' (for tool result formatting)
  sessionFile,            // absolute path to JSONL session transcript
  workspaceDir,           // ext.resolveAgentWorkspaceDir(ocConfig, agentId)
  config,                 // api.config (OpenClawConfig)
  prompt,                 // user message text
  timeoutMs,              // number in ms (default 30000)
  runId,                  // unique string e.g. 'sip:${sessionId}:${Date.now()}'
  lane,                   // optional — 'voice' for voice-specific lane
  agentDir,               // ext.resolveAgentDir(ocConfig, agentId)
  // also: provider, model, thinkLevel, verboseLevel, extraSystemPrompt
});

// result.payloads: Array<{ text?: string; isError?: boolean }>
const text = (result.payloads || [])
  .filter(p => p.text && !p.isError)
  .map(p => p.text.trim())
  .join(' ').trim();
```

**Correct function signatures** (from `core-bridge.ts` — NOT the same as `extensionAPI.js` exports):
```typescript
resolveStorePath(store?: string, opts?: { agentId?: string }) => string
// store = optional path string from ocConfig?.session?.store — NOT the full config object

ensureAgentWorkspace(params?: { dir: string }) => Promise<void>
// dir = the resolved workspaceDir string — NOT (config, agentId)

resolveAgentDir(cfg: CoreConfig, agentId: string) => string
resolveAgentWorkspaceDir(cfg: CoreConfig, agentId: string) => string
// CoreConfig = { session?: { store?: string }, [key: string]: unknown }
// api.config (OpenClawConfig) satisfies this
```

**Session file path**:
```js
const storePath = ext.resolveStorePath(ocConfig?.session?.store); // pass store string, not config
const agentDir = ext.resolveAgentDir(ocConfig, agentId);
const workspaceDir = ext.resolveAgentWorkspaceDir(ocConfig, agentId);
const sessionFile = path.join(storePath, 'sip-voice', `${agentId}-${sessionId}.jsonl`);
await ext.ensureAgentWorkspace({ dir: workspaceDir }); // pass { dir: string }, not (config, agentId)
```

## Configuration Flow

Plugin config lives in OpenClaw's config file under `plugins.entries.<id>.config`:

```yaml
plugins:
  entries:
    my-plugin:
      enabled: true
      config:
        port: 47334
        apiKey: "shared-secret"
```

Config is validated against the JSON Schema in `openclaw.plugin.json` at config read/write time. Access at runtime via `api.pluginConfig`.

## Installation

```bash
# Development (symlink — changes reflect immediately)
openclaw plugins install -l ~/path/to/plugin

# Production (npm package)
openclaw plugins install my-plugin-package
```

After install, the plugin appears in `openclaw plugins list`. Enable/configure via OpenClaw config.

## Trust & Security

- Non-bundled plugins require `plugins.allow` allowlist or emit warnings
- Plugin-managed hooks appear namespaced as `plugin:<id>` in `openclaw hooks list`
- Disabled plugins retain config but generate warnings on validation

## Reference: Stock Plugin Inventory (2026.2.21)

| Plugin | Type | Pattern | Key APIs Used |
|---|---|---|---|
| discord | Channel | registerChannel | outbound, gateway, setup, streaming |
| telegram | Channel | registerChannel | outbound, gateway, pairing |
| slack | Channel | registerChannel | outbound, gateway, threading |
| voice-call | Service | registerService + registerGatewayMethod + registerTool | service, gateway, tool, CLI |
| memory-core | Tool | registerTool + registerCli | tool, CLI |
| talk-voice | Command | registerCommand | command only |

## Reference: voice-call Plugin Structure

The `@openclaw/voice-call` plugin is the closest architectural reference for our SIP voice plugin:

```
voice-call/
├── index.ts                  # Plugin entry: register() with lazy runtime
├── package.json              # openclaw.extensions: ["./index.ts"]
├── openclaw.plugin.json      # Full JSON Schema config
└── src/
    ├── config.ts             # Zod schemas, env var merging
    ├── types.ts              # CallRecord, CallState, NormalizedEvent
    ├── runtime.ts            # Factory: provider + manager + webhook server
    ├── manager.ts            # CallManager (state ownership, Map-based)
    ├── webhook.ts            # HTTP server + WebSocket media streaming
    ├── core-bridge.ts        # Bridge to runEmbeddedPiAgent()
    ├── response-generator.ts # AI response via embedded agent
    ├── cli.ts                # CLI command registration
    ├── allowlist.ts          # Phone number allowlist checking
    └── providers/
        ├── base.ts           # VoiceCallProvider interface
        ├── twilio.ts         # Twilio implementation
        ├── telnyx.ts         # Telnyx implementation
        └── ...
```

Key architectural decisions in voice-call:
- **Lazy runtime**: `ensureRuntime()` defers heavy init until first use
- **JSONL persistence**: call records at `~/.openclaw/voice-calls/calls.jsonl`
- **Provider abstraction**: Twilio/Telnyx/Plivo behind common interface
- **Embedded agent**: uses `runEmbeddedPiAgent()` for in-process AI (no HTTP)

## Our SIP Voice Plugin: Architectural Differences

| Aspect | voice-call (stock) | sip-voice (ours) |
|---|---|---|
| Deployment | Single server (plugin + telephony co-located) | Two servers (voice-app on VPS, plugin on OpenClaw server) |
| Agent interaction | `runEmbeddedPiAgent()` in-process | HTTP webhook (`POST /voice/query`) |
| Telephony | Twilio/Telnyx SIP trunks | FreePBX + BulkVS via drachtio-srf |
| Media handling | WebSocket streaming + provider TTS | FreeSWITCH RTP + ElevenLabs TTS + Whisper STT |
| Session storage | JSONL persistence | In-memory Map (OpenClaw bug #3290) |
| Pattern | Service plugin | Service plugin (same) |

# OpenClaw SIP Voice Plugin — Setup Guide

## Installation

**Development (symlink from repo):**
```bash
openclaw plugins install -l ./openclaw-plugin
```

**Production (npm):**
```bash
openclaw plugins install openclaw-sip-voice
```

## Plugin Configuration

Add to `~/.openclaw/openclaw.json` under the plugin config section:

```yaml
sip-voice:
  webhookPort: 3334          # Port for voice-app → plugin webhook (POST /voice/query)
  apiKey: "your-secret-key"  # Must match OPENCLAW_API_KEY in voice-app .env
  voiceAppUrl: "http://vitalpbx-server:3000/api"  # Voice-app REST API base URL (for outbound calls)
  accounts:
    - id: morpheus
      extension: "9000"
    - id: cephanie
      extension: "9001"
  bindings:
    - accountId: morpheus
      agentId: morpheus
    - accountId: cephanie
      agentId: cephanie
  identityLinks:
    operator: ["sip-voice:+15551234567"]
```

### Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhookPort` | number | No (default: 47334) | Port the plugin webhook server listens on |
| `apiKey` | string | Yes | Bearer token for voice-app → plugin auth |
| `voiceAppUrl` | string | Yes (for outbound calls) | Base URL of voice-app REST API, e.g. `http://host:3000/api` |
| `accounts` | array | Yes | SIP device accounts (id + extension) used for agent binding |
| `bindings` | array | Yes | Maps accountId (device) to agentId (OpenClaw agent) |
| `identityLinks` | object | No | Maps operator names to SIP identity strings |
| `dmPolicy` | string | No (default: "allowlist") | How the voice-app handles callers not in allowFrom |
| `agentTimeoutMs` | number | No (default: 30000) | Agent response timeout in milliseconds |

### `voiceAppUrl` Detail

The `voiceAppUrl` field enables the plugin to trigger outbound calls on behalf of agents. It should point to the voice-app Express API base path:

- Format: `http://<voice-app-host>:<port>/api`
- Default voice-app port: `3000`
- Example: `http://vitalpbx-server:3000/api`

The plugin appends `/outbound-call` to this URL when placing calls.

**Network note:** The voice-app and OpenClaw plugin may run on different servers. Ensure the OpenClaw gateway can reach the voice-app on port 3000 over the internal network.

### Caller Allowlists (`allowFrom`)

Caller allowlist enforcement happens in the **voice-app**, not the plugin. Configure `allowFrom` per device in `voice-app/config/devices.json`:

```json
{
  "extension": "9000",
  "name": "morpheus",
  "accountId": "morpheus",
  "allowFrom": ["+15551234567"]
}
```

- Empty or missing `allowFrom` → allow all callers
- DID-exposed extensions should always set a non-empty `allowFrom`

## Voice-App Configuration

In `voice-app/.env`, ensure these are set to match the plugin:

```bash
BRIDGE_TYPE=openclaw
OPENCLAW_WEBHOOK_URL=http://openclaw-server:3334
OPENCLAW_API_KEY=your-secret-key  # Must match plugin apiKey
```

## Verify Installation

After restarting OpenClaw gateway:

```bash
# Check plugin webhook is listening
curl http://localhost:3334/voice/health
# Expected: {"ok":true}

# Check voice-app outbound API (from openclaw-gateway)
curl http://vitalpbx-server:3000/api/calls
# Expected: {"success":true,"count":0,"calls":[]}
```

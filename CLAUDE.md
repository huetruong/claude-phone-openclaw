# Claude Phone — FreePBX + OpenClaw

Voice channel for OpenClaw agents via SIP/FreePBX. Call your agent, and your agent can call you.

## Project Overview

`openclaw-sip-voice` gives OpenClaw agents a SIP telephone presence via FreePBX and BulkVS:
- **Inbound**: Call an extension and talk to an OpenClaw agent — each extension routes to a distinct agent
- **Outbound**: Agents can initiate calls autonomously (alerts, task completion callbacks)
- **Multi-agent**: Speed dial 9000 for ops agent, 9002 for research agent — routing is deterministic

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | Node.js (CommonJS for voice-app and plugin) |
| SIP Server | drachtio-srf |
| Media Server | FreeSWITCH (via drachtio-fsmrf) |
| STT | OpenAI Whisper API |
| TTS | ElevenLabs API (per-agent voice selection) |
| AI Backend | OpenClaw (via channel plugin) or Claude Code CLI (via claude-api-server) |
| PBX | FreePBX (reference; voice-app is PBX-agnostic at SIP layer) |
| SIP Trunk | BulkVS |
| Container | Docker Compose |

## Architecture

```
BulkVS (SIP trunk)
    │ DID inbound/outbound
    ↓
FreePBX  ← configure trunk + extensions via web GUI
    │ SIP (port 5060)
    ↓
┌─────────────────────────────────────────────────┐
│  voice-app (Docker — VPS)                        │
│  drachtio  │  FreeSWITCH  │  Node.js logic       │
│                 │                                 │
│          openclaw-bridge.js                      │
└─────────────────────┬───────────────────────────┘
                      │ HTTP POST /voice/query
                      ↓
┌─────────────────────────────────────────────────┐
│  openclaw-plugin (OpenClaw server)               │
│  webhook-server.js + session-store.js            │
│       │                                          │
│  OpenClaw gateway (in-process)                   │
│  agents: morpheus (9000), cephanie (9002), ...   │
└─────────────────────────────────────────────────┘
```

## Directory Structure

```
claude-phone-freepbx/
├── CLAUDE.md                     # This file
├── README.md                     # User-facing documentation
├── install.sh                    # One-command installer
├── package.json                  # Root package (linting, tests)
├── eslint.config.js              # ESLint configuration
├── docker-compose.yml            # Multi-container orchestration
├── .env.example                  # Environment template
├── .gitlab-ci.yml                # CI/CD pipeline
│
├── voice-app/                    # Docker container — voice handling (BROWNFIELD)
│   ├── Dockerfile
│   ├── package.json
│   ├── index.js                  # Main entry point
│   ├── config/
│   │   └── devices.json          # Device config (add accountId per device)
│   └── lib/
│       ├── openclaw-bridge.js    # NEW — drop-in for claude-bridge.js
│       ├── claude-bridge.js      # Original Claude CLI bridge (unchanged)
│       ├── audio-fork.js         # WebSocket audio + VAD
│       ├── conversation-loop.js  # Core conversation flow
│       ├── multi-registrar.js    # Multi-extension SIP registration
│       ├── tts-service.js        # ElevenLabs TTS
│       ├── whisper-client.js     # OpenAI Whisper STT
│       └── ...                   # All other lib files unchanged
│
├── openclaw-plugin/              # NEW — OpenClaw channel plugin
│   ├── openclaw.plugin.json      # Plugin manifest
│   ├── package.json
│   └── src/
│       ├── index.js              # Entry point: api.registerChannel()
│       ├── webhook-server.js     # Express: /voice/query, /voice/end-session, /voice/health
│       ├── session-store.js      # In-memory Map (callId → sessionId)
│       ├── auth.js               # Bearer token middleware → 401
│       └── logger.js             # [sip-voice] prefixed logger
│
├── claude-api-server/            # HTTP wrapper for Claude Code CLI (unchanged)
│   ├── package.json
│   ├── server.js
│   └── structured.js
│
├── cli/                          # Unified CLI tool (unchanged)
│   └── ...
│
└── docs/
    ├── TROUBLESHOOTING.md        # Common issues
    ├── freepbx-setup.md          # FreePBX + BulkVS trunk setup guide
    └── openclaw-plugin-setup.md  # Plugin install + config guide
```

## Bridge Selection

The voice-app supports two backends, selected via `BRIDGE_TYPE`:

| `BRIDGE_TYPE` | Bridge file | AI backend |
|---|---|---|
| `claude` (default) | `claude-bridge.js` | Claude Code CLI via `claude-api-server` |
| `openclaw` | `openclaw-bridge.js` | OpenClaw agents via channel plugin |

```bash
# .env
BRIDGE_TYPE=openclaw
OPENCLAW_WEBHOOK_URL=http://openclaw-server:47334
OPENCLAW_API_KEY=your-api-key
```

## Plugin HTTP Contract

**voice-app → plugin:**

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/voice/query` | `{ prompt, callId, accountId, peerId }` | `200 { response }` |
| POST | `/voice/end-session` | `{ callId }` | `200 { ok: true }` |
| GET | `/voice/health` | — | `200 { ok: true }` |

**plugin → voice-app:**

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/outbound-call` | `{ to, accountId, message }` | `200 { callId }` |

All plugin endpoints require `Authorization: Bearer <OPENCLAW_API_KEY>`.

## Device Configuration

Add `accountId` to each device in `voice-app/config/devices.json`:

```json
{
  "extension": "9000",
  "name": "morpheus",
  "accountId": "morpheus",
  "voiceId": "...",
  "authId": "9000",
  "password": "...",
  "allowFrom": ["+15551234567"]
}
```

## Plugin Configuration (OpenClaw side)

```yaml
sip-voice:
  webhookPort: 47334
  apiKey: "..."
  dmPolicy: allowlist
  accounts:
    - id: morpheus
      extension: "9000"
      allowFrom: ["+15551234567"]
  bindings:
    - accountId: morpheus
      agentId: morpheus
  identityLinks:
    hue: ["sip-voice:+15551234567"]
```

## Plugin Installation

```bash
# Development (symlink)
openclaw plugins install -l ./openclaw-plugin

# Production (npm)
openclaw plugins install openclaw-sip-voice
```

## Development

### Running Tests

```bash
npm test                  # All tests
npm run test:voice-app    # Voice app tests only
```

### Linting

```bash
npm run lint              # Check for issues
npm run lint:fix          # Auto-fix issues
```

### Deployment

- **voice-app**: `docker compose up --build voice-app` on VPS
- **plugin**: edit `openclaw-plugin/src/`, restart OpenClaw gateway
- **Both from same git clone** — pull on each server, restart respective service

## Key Design Decisions

1. **CommonJS for voice-app and plugin** — drachtio ecosystem incompatible with ESM
2. **Host networking mode** — required for FreeSWITCH RTP
3. **Two-server deployment** — voice-app on VPS, plugin on OpenClaw server; HTTP-only boundary
4. **In-memory session Map** — OpenClaw wipes runtime state on restart (bug #3290); persistence adds no value
5. **Session lifecycle split** — `endSession` closes voice-app session only; OpenClaw agent workspace persists
6. **Bridge pattern** — `openclaw-bridge.js` is drop-in for `claude-bridge.js`; voice-app unchanged structurally
7. **RTP ports 30000–30100** — configurable, avoids conflicts with other SIP services
8. **FreePBX as reference PBX** — free, open-source, Asterisk-based; voice-app works with any SIP-compatible PBX
9. **Plugin is non-blocking** — all plugin code async/await; no sync I/O (runs in OpenClaw gateway event loop)

## Environment Variables

See `.env.example` for all variables. Key ones:

| Variable | Component | Purpose |
|----------|-----------|---------|
| `EXTERNAL_IP` | voice-app | Server LAN IP for RTP routing |
| `BRIDGE_TYPE` | voice-app | `claude` or `openclaw` |
| `OPENCLAW_WEBHOOK_URL` | voice-app | URL to openclaw-plugin webhook server |
| `OPENCLAW_API_KEY` | voice-app | API key for webhook auth |
| `CLAUDE_API_URL` | voice-app | URL to claude-api-server (when BRIDGE_TYPE=claude) |
| `ELEVENLABS_API_KEY` | voice-app | TTS API key |
| `OPENAI_API_KEY` | voice-app | Whisper STT API key |
| `SIP_DOMAIN` | voice-app | FreePBX server FQDN |
| `SIP_REGISTRAR` | voice-app | SIP registrar address |

## Security Rules

- `allowFrom` per-extension allowlist enforced before any agent invocation
- `dmPolicy: allowlist` mandatory default for DID-exposed extensions
- Webhook API key required on all plugin endpoints — 401 before processing
- SIP credentials: never logged at any level
- Caller phone numbers (`peerId`): DEBUG level only, excluded from INFO/WARN/ERROR
- No call audio persisted beyond in-memory STT buffer

## Documentation

- [README.md](README.md) - User quickstart
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Common issues
- [docs/freepbx-setup.md](docs/freepbx-setup.md) - FreePBX + BulkVS setup
- [docs/openclaw-plugin-setup.md](docs/openclaw-plugin-setup.md) - Plugin install guide
- [voice-app/DEPLOYMENT.md](voice-app/DEPLOYMENT.md) - Production deployment
- [voice-app/README-OUTBOUND.md](voice-app/README-OUTBOUND.md) - Outbound API
- [docs/openclaw-plugin-architecture.md](docs/openclaw-plugin-architecture.md) - OpenClaw plugin SDK reference
- [_bmad-output/planning-artifacts/prd.md](_bmad-output/planning-artifacts/prd.md) - PRD
- [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md) - Architecture

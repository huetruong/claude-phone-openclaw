---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-02-22'
inputDocuments: ['_bmad-output/planning-artifacts/prd.md', 'docs/TROUBLESHOOTING.md', 'CLAUDE.md']
workflowType: 'architecture'
project_name: 'claude-phone-vitalpbx'
user_name: 'Operator'
date: '2026-02-22'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (31 total):**

- Call Routing & Extension Management (FR1–FR4): Multi-extension SIP registration, concurrent isolated sessions, extension → agent mapping
- Caller Authentication & Access Control (FR5–FR6, FR8): `allowFrom` allowlist, unknown caller rejection (silent hangup), webhook API key auth. FR7 (`dmPolicy`) removed — `allowFrom` empty/missing = allow all is sufficient.
- Conversation & Session Management (FR9–FR13): `peerId` passing, voice/agent session independence, hangup cleanup, in-flight query abort, goodbye detection
- Audio Processing & UX (FR14–FR17): STT, TTS with per-agent voice, SIP MOH on hold, graceful unavailability message
- Outbound Calling (FR18–FR20): Agent-initiated and API-triggered outbound, identity resolution via `identityLinks`
- Plugin Integration (FR21–FR26): OpenClaw channel registration, agent routing, response delivery, session event notification, independent lifecycle
- Configuration & Operations (FR27–FR31): Env-var driven config, structured JSON device config, PII-safe logging

**Non-Functional Requirements:**

- Performance: <5s round-trip, <500ms call answer, MOH within 1s of query dispatch
- Security: Credentials never logged, PII at DEBUG only, no audio persisted to disk, 401 on unauthenticated webhook
- Reliability: Auto re-registration, 100% answer rate when running, graceful degradation on OpenClaw unreachable, <5s session cleanup on hangup
- Integration: All async (no sync I/O in gateway), no native deps, drop-in bridge interface compatible with `claude-bridge.js`

**Scale & Complexity:**

- Primary domain: infrastructure/integration (two-component, two-server)
- Complexity level: medium (brownfield, solo developer, fixed MVP scope)
- Estimated architectural components: 4 (voice-app bridge, OpenClaw plugin, webhook HTTP server, outbound call API client)

### Technical Constraints & Dependencies

- CommonJS required for voice-app (drachtio ecosystem incompatible with ESM)
- Node.js ≥18 LTS (voice-app); Node.js ≥22 (OpenClaw gateway)
- No native build dependencies — must install on Linux VPS without node-gyp
- All plugin code non-blocking — runs inside OpenClaw gateway event loop
- No TypeScript compilation step — plain JS with JSDoc if needed
- FreePBX chosen as reference PBX (free, open-source, Asterisk-based); voice-app is PBX-agnostic at the SIP layer
- BulkVS as SIP trunk provider (existing operator account)
- Deployment-confirmed: OpenClaw plugin API uses `api.registerService()` for service plugins — NOT `api.registerChannel()` (requires full ChannelPlugin interface) or `gateway.start()` / `gateway.on()` as PRD originally assumed. See `docs/openclaw-plugin-architecture.md`.

### Cross-Cutting Concerns Identified

- **Session lifecycle duality** — voice session and agent workspace are independent; teardown signals must not conflate them
- **Caller identity & PII** — phone numbers flow through both components; logging discipline enforced at both layers
- **Graceful degradation** — OpenClaw unreachable, voice-app unreachable, or plugin startup failure must each produce safe, audible fallback
- **SIP resilience** — registration recovery handled by `multi-registrar.js` (existing); plugin must tolerate voice-app restarts
- **Security boundary** — two checkpoints (voice-app `allowFrom`, plugin API key) with defense-in-depth; neither replaces the other

## Starter Template Evaluation

### Primary Technology Domain

Infrastructure/integration plugin — two-component brownfield project. No greenfield scaffold applies.

### Approach

**voice-app side:** Based on jayis1/claude-phone-but-for-Gemini-and-freepbx fork (drachtio + FreeSWITCH + FreePBX). Merge existing VitalPBX compatibility fixes. No scaffold — existing codebase is the foundation.

**openclaw-plugin side:** Minimal Node.js package initialized from scratch. Pattern derived from OpenClaw's voice-call extension source. Plain CommonJS, no TypeScript compilation, no native deps (per PRD constraints). Reference implementation: openclaw/openclaw `extensions/voice-call`.

### Initialization

```bash
# Plugin package (inside this repo)
mkdir openclaw-plugin && cd openclaw-plugin && npm init -y
# Then: openclaw.plugin.json + src/index.js
```

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Session state: in-memory Map (callId → OpenClaw sessionId) per plugin process lifetime
- HTTP framework: Express (consistent with voice-app)
- Plugin approach: Option B — service plugin via `api.registerService()`

**Important Decisions (Shape Architecture):**
- MOH: SIP re-INVITE best-effort only; silence if PBX doesn't support it
- `endSilenceMs`: hardcoded 1500ms — not operator-configurable at MVP

**Deferred Decisions (Post-MVP):**
- Session persistence across gateway restarts (blocked by OpenClaw bug #3290 upstream)
- Redis session store (no value until OpenClaw fixes `chatRunState.clear()` on restart)

### Data Architecture

No database. State is fully ephemeral:
- Plugin: in-memory Map (callId → sessionId), cleared on gateway restart
- OpenClaw: file-based session storage (`~/.openclaw/agents/<id>/sessions/`), runtime state (`chatRunState`) cleared on restart — known upstream bug #3290
- voice-app: per-call async context, cleared on hangup
- Config: `devices.json` (voice-app) + OpenClaw plugin config YAML + env vars

On plugin startup: mark all non-terminal call state as ended (matches voice-call plugin `staleCallReaperSeconds` pattern).

### Authentication & Security

- voice-app boundary: `allowFrom` per-extension allowlist checked before agent invocation — empty/missing `allowFrom` = allow all; populated = enforce list
- Plugin boundary: API key (Bearer token) on `POST /voice/query` and `POST /voice/end-session`; unauthenticated requests → 401 before any processing
- No `dmPolicy` field — removed after Story 3.2 code review; `allowFrom` semantics are sufficient
- SIP credentials: `devices.json`, chmod 600, never logged
- Caller phone numbers: DEBUG level only, excluded from INFO/WARN/ERROR

### API & Communication Patterns

- Transport: HTTP REST between voice-app and plugin (internal network, no TLS required for MVP)
- Plugin webhook server: Express, port 47334
- Endpoints: `POST /voice/query`, `POST /voice/end-session`, `GET /voice/health`
- Error handling: plugin unreachable → voice-app logs error, plays configurable unavailability message; no retry (voice calls are time-sensitive)
- No rate limiting (trusted internal network between two servers)

### Infrastructure & Deployment

- voice-app: Docker Compose (existing), VPS
- Plugin: `openclaw plugins install -l ./openclaw-plugin` on OpenClaw server
- Both deployed from same git repo (monorepo)
- Logging: `[sip-voice]` prefix, structured, PII-safe
- Health: `GET /voice/health` for liveness checks from voice-app

## Implementation Patterns & Consistency Rules

### Critical Conflict Points

6 areas where agent implementation choices could break the integration silently.

### Bridge Interface Contract (MANDATORY)

`openclaw-bridge.js` MUST export exactly this interface — drop-in compatible with `claude-bridge.js`:

```js
module.exports = {
  async query(prompt, callId, deviceConfig) {
    // returns { response: string }
  },
  async endSession(callId) {
    // returns void
  },
  async isAvailable() {
    // returns boolean
  }
};
```

No additional exports. No renamed methods. No changed signatures.

### HTTP Contract (MANDATORY)

**voice-app → plugin:**

```
POST /voice/query
Authorization: Bearer <OPENCLAW_API_KEY>
{ "prompt": string, "callId": string, "accountId": string, "peerId": string }

→ 200 { "response": string }
→ 401 (missing/invalid API key)
→ 503 { "error": string } (OpenClaw unreachable)
```

```
POST /voice/end-session
Authorization: Bearer <OPENCLAW_API_KEY>
{ "callId": string }

→ 200 { "ok": true }
```

```
GET /voice/health
→ 200 { "ok": true }
```

**plugin → voice-app (outbound):**

```
POST /api/outbound-call
{ "to": string, "accountId": string, "message": string }

→ 200 { "callId": string }
```

### Session Key Format

- `callId` = drachtio `callUuid` (UUID v4 format, lowercase, hyphenated)
- Used as Map key in plugin: `sessions.set(callId, sessionId)`
- Used as session reference in OpenClaw via `--resume <sessionId>` pattern (jayis1 template)
- NEVER transform or hash the callId — pass it through verbatim

### Module System Rules

**voice-app and openclaw-plugin: CommonJS only**

```js
// CORRECT
const express = require('express');
module.exports = { query, endSession };

// WRONG — breaks drachtio ecosystem
import express from 'express';
export default { query, endSession };
```

### Async Rules (Plugin Only)

All plugin code runs inside the OpenClaw gateway event loop.

```js
// CORRECT
async function handleQuery(req, res) {
  const result = await fetch(OPENCLAW_URL, { ... });
  res.json({ response: result });
}

// WRONG — blocks all agents on the gateway
const config = fs.readFileSync('config.json');
```

No synchronous I/O anywhere in `openclaw-plugin/`. Use `fs.promises` if file I/O is needed.

### Logging Rules

```js
// CORRECT — phone number at DEBUG only
logger.debug(`[sip-voice] inbound call from ${callerNumber}`);
logger.info(`[sip-voice] inbound call answered`, { callId, accountId });

// WRONG — PII at INFO level
logger.info(`[sip-voice] call from ${callerNumber}`);
```

All log lines in the plugin MUST be prefixed `[sip-voice]`.

### Error Handling Pattern

```js
// Plugin: OpenClaw unreachable
try {
  const result = await queryOpenClaw(prompt, sessionId);
  res.json({ response: result });
} catch (err) {
  logger.error('[sip-voice] OpenClaw query failed', { callId, error: err.message });
  res.status(503).json({ error: 'agent unavailable' });
  // voice-app plays configurable unavailability message on 503
}
```

Never let errors propagate uncaught in Express route handlers.

### Enforcement

**All agents implementing this project MUST:**
- Verify bridge method signatures against `claude-bridge.js` before marking story complete
- Use only `require()`/`module.exports` — no ESM
- Prefix all plugin log lines with `[sip-voice]`
- Never log `peerId` (caller phone number) above DEBUG level
- Return HTTP 401 before any processing for missing/invalid API key
- Handle all async errors explicitly — no unhandled promise rejections

## Project Structure & Boundaries

### Complete Project Directory Structure

```
claude-phone-freepbx/                  ← repo root (rename from claude-phone-vitalpbx)
├── .gitlab-ci.yml                     ← CI/CD pipeline (lint, test, deploy)
├── docker-compose.yml                 ← existing
├── .env.example                       ← existing + new BRIDGE_TYPE, OPENCLAW_* vars
├── package.json                       ← existing (root linting + tests)
├── eslint.config.js                   ← existing
├── install.sh                         ← existing
├── CLAUDE.md                          ← existing
├── README.md                          ← update for FreePBX + OpenClaw
│
├── voice-app/                         ← BROWNFIELD — minimal changes only
│   ├── Dockerfile                     ← existing, unchanged
│   ├── package.json                   ← existing, unchanged
│   ├── index.js                       ← existing, unchanged
│   ├── config/
│   │   └── devices.json               ← add accountId field per device
│   └── lib/
│       ├── openclaw-bridge.js         ← NEW (only new file in voice-app)
│       ├── claude-bridge.js           ← existing, unchanged
│       ├── conversation-loop.js       ← existing, unchanged
│       ├── audio-fork.js              ← existing, unchanged
│       └── ... (all other lib files unchanged)
│
├── claude-api-server/                 ← existing, unchanged
│   ├── server.js
│   └── package.json
│
├── openclaw-plugin/                   ← NEW — OpenClaw channel plugin
│   ├── openclaw.plugin.json           ← plugin manifest
│   ├── package.json
│   ├── src/
│   │   ├── index.js                   ← entry point: api.registerService()
│   │   ├── webhook-server.js          ← Express: /voice/query, /voice/end-session, /voice/health
│   │   ├── session-store.js           ← in-memory Map (callId → sessionId)
│   │   ├── auth.js                    ← Bearer token middleware → 401
│   │   └── logger.js                  ← [sip-voice] prefixed logger
│   └── test/
│       └── webhook.test.js            ← unit tests for webhook handlers
│
├── cli/                               ← existing, unchanged
│   └── ...
│
└── docs/
    ├── TROUBLESHOOTING.md             ← existing
    ├── freepbx-setup.md               ← NEW: FreePBX + BulkVS trunk setup
    └── openclaw-plugin-setup.md       ← NEW: plugin install + config guide
```

### Architectural Boundaries

**Two hard boundaries — HTTP only crosses them:**

```
[FreePBX + BulkVS]
      │ SIP (port 5060)
      ↓
[voice-app Docker]  ──── HTTP POST /voice/query ────►  [openclaw-plugin]
      │                ◄─── HTTP 200 { response } ───        │
      │                                                 (in-process with
      └── HTTP POST /api/outbound-call ◄──────────────  OpenClaw gateway)
```

**voice-app boundary:** SIP (inbound from FreePBX), HTTP (outbound to plugin)
**plugin boundary:** HTTP (inbound from voice-app), in-process API (outbound to OpenClaw)

### Requirements to Structure Mapping

| FR Group | Location |
|---|---|
| FR1–FR4 Call routing | `voice-app/lib/openclaw-bridge.js` + `devices.json` |
| FR5–FR6, FR8 Caller auth | `conversation-loop.js` (allowFrom) + `openclaw-plugin/src/auth.js` (API key). FR7 removed. |
| FR9–FR13 Session mgmt | `openclaw-bridge.js` (endSession) + `openclaw-plugin/src/session-store.js` |
| FR14–FR17 Audio/UX | existing voice-app (unchanged) |
| FR18–FR20 Outbound | `openclaw-plugin/src/index.js` → POST /api/outbound-call |
| FR21–FR26 Plugin integration | `openclaw-plugin/src/` (all files) |
| FR27–FR31 Config & ops | env vars + `devices.json` + `openclaw.plugin.json` |

### Integration Points

**Internal (same repo, different servers):**
- `voice-app` → `openclaw-plugin`: `POST /voice/query` (every STT result)
- `voice-app` → `openclaw-plugin`: `POST /voice/end-session` (every hangup)
- `openclaw-plugin` → `voice-app`: `POST /api/outbound-call` (agent-initiated calls)
- `voice-app` → `openclaw-plugin`: `GET /voice/health` (liveness check)

**External:**
- `voice-app` ↔ FreePBX: SIP registration + INVITE/BYE/OPTIONS
- FreePBX ↔ BulkVS: SIP trunk (operator-configured)

### Data Flow — Inbound Call

```
1. BulkVS → FreePBX (PSTN INVITE)
2. FreePBX → voice-app (SIP INVITE to registered extension)
3. voice-app: VAD → Whisper STT → text
4. voice-app openclaw-bridge.js → POST /voice/query { prompt, callId, accountId, peerId }
5. openclaw-plugin/webhook-server.js → OpenClaw agent (in-process)
6. OpenClaw → plugin → 200 { response: "..." }
7. voice-app → ElevenLabs TTS → audio → caller
```

### Development Workflow

- **voice-app changes:** `docker compose up --build voice-app` on VPS
- **plugin changes:** edit `openclaw-plugin/src/`, restart OpenClaw gateway on OpenClaw server
- **Both from same clone:** `git pull` on each server, restart respective service
- **Tests:** `npm test` at repo root (voice-app + plugin tests)

## Architecture Validation Results

### Coherence Validation ✅

All technology choices are compatible: CommonJS throughout, Express consistent, Node.js runtimes are separate and non-conflicting, in-memory session model matches OpenClaw's own ephemeral runtime state. HTTP-only boundary between servers is clean and independently testable. Async constraint aligns with chosen Express + fetch pattern.

### Requirements Coverage ✅

All 31 functional requirements and 19 non-functional requirements are architecturally supported. No FR is left without an identified owner file or component. See Requirements to Structure Mapping in Project Structure section.

### Gap Analysis

**Minor (non-blocking):**

1. `openclaw.plugin.json` required fields:
   ```json
   {
     "id": "openclaw-sip-voice",
     "version": "1.0.0",
     "name": "SIP Voice Channel",
     "description": "SIP telephone channel for OpenClaw agents",
     "main": "src/index.js",
     "configSchema": { }
   }
   ```

2. Bridge loader pattern — in `voice-app/index.js` or `conversation-loop.js`:
   ```js
   const bridgeType = process.env.BRIDGE_TYPE || 'claude';
   const bridge = require(`./lib/${bridgeType}-bridge`);
   ```
   One env var, one require() line. No new files needed.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] 31 FRs and 19 NFRs analyzed for architectural implications
- [x] Scale assessed: medium complexity, brownfield, solo developer
- [x] Technical constraints identified: CommonJS, async-only, no native deps
- [x] Cross-cutting concerns mapped: sessions, PII, degradation, SIP resilience

**✅ Architectural Decisions**
- [x] Session state: in-memory Map (confirmed against OpenClaw restart behavior)
- [x] HTTP framework: Express
- [x] Plugin approach: Option B — service plugin via `api.registerService()` (deployment-confirmed)
- [x] PBX: FreePBX (reference); voice-app PBX-agnostic
- [x] MOH: SIP re-INVITE best-effort, silence fallback

**✅ Implementation Patterns**
- [x] Bridge interface contract (MANDATORY — drop-in compatibility)
- [x] HTTP contract (MANDATORY — exact JSON shapes)
- [x] Session key format (callId = drachtio UUID, verbatim)
- [x] Module system: CommonJS only
- [x] Async discipline: no sync I/O in plugin
- [x] Logging: `[sip-voice]` prefix, PII at DEBUG only

**✅ Project Structure**
- [x] Complete directory tree with all new and modified files
- [x] Two hard boundaries defined (SIP, HTTP)
- [x] All integration points mapped
- [x] FR groups mapped to specific files

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence: High** — brownfield base is proven, new surface area is small (one new file in voice-app, five new files in plugin), HTTP contract is fully specified, patterns prevent the most likely agent conflicts.

**Key Strengths:**
- Minimal changes to proven voice-app codebase (one new file)
- jayis1 gemini-api-server provides direct implementation template for `openclaw-bridge.js`
- Clean HTTP boundary makes components independently testable
- All critical implementation rules documented with examples

**Areas for Future Enhancement (Post-MVP):**
- Option C: self-hosted VoiceCallProvider for OpenClaw voice-call extension (community contribution)
- Redis session store (once OpenClaw fixes bug #3290)
- Cross-channel response delivery (Phase 2)
- `place_call` agent tool registration (Phase 2 — Epic 5 Story 5.3)

### Implementation Handoff

**First implementation priority:** `voice-app/lib/openclaw-bridge.js`
Use jayis1's gemini-api-server as the direct template — replace Gemini CLI subprocess with HTTP POST to OpenClaw webhook.

**Second:** `openclaw-plugin/src/` scaffold — `webhook-server.js`, `auth.js`, `session-store.js`, `index.js` with `api.registerService()`

**AI Agent Guidelines:**
- Follow bridge interface contract exactly — verify against `claude-bridge.js`
- Use CommonJS only — no import/export
- Prefix all plugin logs with `[sip-voice]`
- Never log `peerId` above DEBUG level
- Return 401 before any processing on missing API key
- Handle all async errors explicitly

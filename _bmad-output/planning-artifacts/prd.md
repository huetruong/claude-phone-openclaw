---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
inputDocuments: ['docs/TROUBLESHOOTING.md', 'docs/CLAUDE-CODE-SKILL.md', 'CLAUDE.md']
workflowType: 'prd'
classification:
  projectType: developer_tool
  domain: general/communications
  complexity: medium
  projectContext: brownfield
---

# Product Requirements Document - claude-phone-vitalpbx

**Author:** Hue
**Date:** 2026-02-22

## Executive Summary

`openclaw-sip-voice` is a channel plugin for the OpenClaw platform that gives OpenClaw agents a SIP telephone presence. Built on the existing `claude-phone-vitalpbx` voice stack (drachtio + FreeSWITCH + VitalPBX), the plugin bridges OpenClaw's multi-agent intelligence — routing, memory, tools, session management — to the real telephone network. Each agent is bound to a SIP extension; calling that extension reaches that agent. Agents can initiate outbound calls autonomously.

The plugin targets developers and homelab operators running OpenClaw who want their agents to operate outside of app-bound messaging — able to reach users directly via phone and receive direct instructions via speed dial.

**Core problem solved:** OpenClaw agents are reactive — they wait to be messaged. Telephony makes them proactive. An agent that can pick up the phone and call you is a collaborator, not a tool. This plugin provides the infrastructure for that shift.

**Cross-channel design:** Voice is intentionally low-bandwidth. When a response exceeds what speech can carry usefully, the agent delivers a brief voice summary and routes the full response to the user's active text channel (Discord, Telegram, WhatsApp). This is intelligent medium selection, not a fallback.

Every other OpenClaw channel is reactive — Discord messages, Telegram texts, Slack pings all wait for the user to open an app. Voice is the only channel where the agent can interrupt with urgency and the user can respond hands-free. No other OpenClaw plugin provides this.

The plugin reuses an existing, proven voice stack (`claude-phone-vitalpbx`) rather than introducing new telephony infrastructure. The gap filled is the intelligence layer — replacing the headless `claude-api-server` with OpenClaw's full agent platform: multi-agent routing, persistent memory, tool access, session scoping, and identity linking across channels.

Multi-agent support means each phone extension is a distinct agent with its own personality, workspace, and capabilities. Speed dial 9000 for your ops agent. Speed dial 9001 for your research agent.

## Success Criteria

### User Success

- A developer installs the plugin and completes configuration in under 30 minutes
- Calling extension 9000 reaches agent "morpheus", calling 9001 reaches agent "cephanie" — routing is deterministic and correct
- The agent's personality, prompt, and voice are applied on every call — not the default
- An OpenClaw agent autonomously initiates an outbound call with no manual trigger required
- When a response is too long for voice, the agent says so on the call and the full response appears in the user's configured text channel
- When the agent is processing (LLM latency), the caller hears PBX on-hold music (SIP re-INVITE `a=sendonly`), not silence

### Technical Success

- SIP registration stays alive without manual intervention (auto re-register, OPTIONS keepalive handled)
- STT → OpenClaw agent → TTS round trip completes in under 5 seconds for typical queries
- Inbound calls answered correctly 100% of the time when voice-app is running
- Sessions scoped per caller number + extension — two callers to the same extension never share context; voice-app handles this natively (each call gets isolated `callUuid`, async context, and OpenClaw session)
- Concurrent call ceiling: ~100 simultaneous calls (bound by RTP port range 30000–30100); acceptable for MVP
- Webhook endpoint (`POST /voice/query`) requires API key authentication — unauthenticated requests rejected with 401
- Caller hangup mid-processing cleanly terminates the in-flight OpenClaw query and ends the session — no orphaned sessions
- Plugin re-registers cleanly on OpenClaw gateway restart without requiring voice-app restart
- Plugin fails gracefully if voice-app is unreachable (logs error, returns "service unavailable" on voice)
- Zero changes to `voice-app` core beyond adding `openclaw-bridge.js` and a `BRIDGE_TYPE` env var

### Measurable Outcomes

- Plugin passes OpenClaw's channel plugin validation (installs, registers, appears in device list)
- All existing `claude-phone-vitalpbx` tests continue to pass after bridge change
- Agent routing verified across at least 2 extensions with distinct agents
- Simultaneous calls to same extension verified isolated (no session bleed)

## Product Scope

**MVP Approach:** Platform MVP — establish SIP voice as a functional, secure OpenClaw channel. The minimum that makes a developer say "this is useful": call an extension, talk to your agent, hang up cleanly. Every extension reaches the right agent. Unknown callers are rejected. The agent persists between calls.

**Resource Profile:** Solo developer (Hue). Implementation order driven by dependency graph.

### MVP — Phase 1

| Capability | Rationale |
|---|---|
| `openclaw-bridge.js` drop-in replacement | Core integration point — without it there is no OpenClaw connection |
| Plugin scaffold + webhook HTTP server | Entry point for OpenClaw channel registration |
| Extension → agent routing (multi-device) | Single hardcoded agent is not the vision |
| `allowFrom` / `dmPolicy` enforcement | DID exposure makes spam a real threat on day 1 |
| Unknown caller rejection + audio message | Public phone number means untrusted callers on day 1 |
| On-hold MOH during agent processing | Dead air is a worse UX failure than LLM latency |
| Graceful hangup cleanup | Orphaned OpenClaw sessions accumulate and corrupt state |
| Caller ID passed to OpenClaw as `peerId` | Required for callback flow |
| `identityLinks` config support | Required for agent to resolve callback number from identity |
| Webhook API key authentication | Unauthenticated webhook is an open relay |
| IVR compatibility documentation | DID + IVR is the deployment model |
| Bridge swap migration guide | Brownfield — existing deployments must upgrade cleanly |

**Core User Journeys Supported:** J1 (Operator Setup), J2 (Trusted Caller Inbound), J3 (Unknown Caller Rejection), J4 (Task Delegation + Callback — caller-initiated)

### Growth Features — Phase 2

- Cross-channel response delivery (voice summary → full text in Discord/Telegram/WhatsApp)
- `place_call` agent tool — registered in OpenClaw, agents can autonomously dial out
- Full identity linking — map caller phone numbers to Discord/Telegram user IDs
- `dmPolicy: pairing` — first-contact verification flow via another channel
- Publish to npm as `openclaw-sip-voice`

### Vision — Phase 3

- SMS channel plugin (separate repo, separate plugin)
- Multi-PBX support (FreePBX, Asterisk direct, hosted SIP trunks)
- Voicemail integration (read voicemail as agent context)
- n8n workflow hooks on call events

### Risk Mitigation

| Risk | Mitigation |
|---|---|
| OpenClaw plugin contract unknown | Bridge and plugin built independently; bridge tested against mock webhook first |
| SIP re-INVITE for MOH varies by PBX | Best-effort implementation; fallback to local `hold-music.mp3` in voice-app |
| Solo developer bandwidth | Scope fixed at MVP list above; Growth requires explicit decision to expand |
| OpenClaw adoption risk | Accepted — personal infrastructure project; npm publish deferred to Growth |

## User Journeys

### Journey 1: The Operator — First Setup
*Hue has OpenClaw running with Discord and Telegram already connected. He wants to add voice.*

He runs `openclaw plugins install openclaw-sip-voice`. Adds two accounts in OpenClaw config: `morpheus` (ext 9000) and `cephanie` (ext 9001), each with SIP credentials, `voiceId`, and an `allowFrom` list of trusted phone numbers. Sets `dmPolicy: "allowlist"` since the channel is bound to a real DID. Sets `BRIDGE_TYPE=openclaw` in voice-app's `.env` and restarts. Calls ext 9000 from his registered number — hears Morpheus greet him. Calls 9001 — Cephanie answers. Speed-dials 9000, asks "what's the disk usage on the prod server?" — gets a 10-word answer on the call, full breakdown lands in Discord.

In VitalPBX he configures the DID and an IVR: "Press 1 for Morpheus, press 2 for Cephanie." No plugin changes needed — VitalPBX routes to the extensions; the plugin sees normal inbound INVITEs.

**Capabilities revealed:** plugin install, config schema, bridge switch, multi-extension routing, cross-channel fallback, `allowFrom` config, IVR compatibility (PBX-side only).

---

### Journey 2: The Caller — Inbound Conversation (trusted number)
*Hue is driving. Calls 9000 via DID.*

He dials the DID, navigates the IVR, gets routed to ext 9000. Caller ID matches his `allowFrom` entry — agent answers. He says "what's running on the prod server?" Hears hold music for 3 seconds while Morpheus processes. Gets a concise answer. Says "goodbye" — call ends cleanly. Voice-app session tears down; OpenClaw agent workspace persists.

**Capabilities revealed:** caller ID verification against `allowFrom`, on-hold MOH during processing, goodbye detection, voice-app-only session teardown (agent persists).

---

### Journey 3: The Spammer — Unknown Caller
*A robocaller or wrong number hits the DID.*

Caller ID is not in `allowFrom`. Plugin detects unknown number, plays configured rejection message, ends the call. Agent is never invoked. No session created. With `dmPolicy: "pairing"`, caller receives a pairing code and instructions to verify via another channel — useful for onboarding new trusted callers without editing config files.

**Capabilities revealed:** `dmPolicy` enforcement (allowlist/pairing/open), unknown caller rejection, configurable rejection message, zero agent exposure to untrusted callers.

---

### Journey 4: Task Delegation + Callback — Hue initiates
*Hue calls, gives a task, hangs up — agent finishes and calls back.*

Hue calls 9000. His number matches `allowFrom` — Morpheus answers. "Clean up logs older than 30 days, call me when done." Hangs up. Voice-app tears down the SIP session; OpenClaw retains full agent context including Hue's phone number (resolved via `identityLinks: { "hue": ["sip-voice:+15551234567"] }`). Morpheus runs cleanup. When done, invokes `place_call` — Hue's phone rings. Brief voice summary. Full log diff in Discord.

**Capabilities revealed:** caller number passed to OpenClaw as `peerId` at call start, `identityLinks` maps number to identity for callback, `place_call` tool, `endSession` = voice-app cleanup only (never agent teardown).

---

### Journey 5: Task Delegation + Callback — Agent initiates
*Agent detects problem, calls Hue, receives instructions, calls back when done.*

Morpheus detects CPU at 94% for 10 minutes. Invokes `place_call` to Hue. "CPU critical on prod." Hue says "restart the web server, call me when done." Hangs up. Morpheus restarts the service. When healthy, calls Hue back — brief voice summary, full metrics in Discord.

**Capabilities revealed:** agent-initiated outbound as first touch, same callback flow. The agent is always running — calls are communication events, not session boundaries.

---

### Journey Requirements Summary

| Capability | Journey | Tier |
|---|---|---|
| Plugin install + config schema | J1 | MVP |
| Multi-extension → agent routing | J1, J2 | MVP |
| Bridge switching (claude → openclaw) | J1 | MVP |
| `allowFrom` / `dmPolicy` enforcement | J1, J3 | MVP |
| Unknown caller rejection + message | J3 | MVP |
| Caller ID passed to OpenClaw as `peerId` | J2, J4 | MVP |
| On-hold MOH during processing | J2 | MVP |
| Goodbye detection + voice-app-only teardown | J2 | MVP |
| `identityLinks` caller → callback number | J4, J5 | MVP |
| Cross-channel response delivery | J1, J2 | Growth |
| `place_call` agent tool | J4, J5 | Growth |
| Agent-initiated outbound | J5 | Growth |
| IVR compatibility (PBX-side config only) | J1 | MVP (docs) |

## Domain-Specific Requirements

### Security / Access Control
- `allowFrom` list validated at call answer time — agent never invoked for unknown callers
- SIP registration credentials stored with restricted permissions (chmod 600), never written to logs
- OpenClaw webhook API key treated as a secret — environment variable only, never in config files committed to version control
- `dmPolicy` defaults to `allowlist` when a DID is configured; `open` only acceptable for internal PBX extensions with no PSTN exposure

### SIP / VoIP Constraints
- DID exposure to PSTN means real threat surface: robocalls, SIP scanners, toll fraud — `allowlist` enforcement is the primary mitigation
- RTP media ports (30000–30100) should not be publicly exposed beyond what VitalPBX requires; firewall rules documented in setup guide
- TLS for SIP signaling recommended (VitalPBX supports it); SRTP for media ideal but not required for MVP
- SIP re-registration must be resilient to network interruptions — already handled by `multi-registrar.js`

### Privacy
- Caller phone numbers are PII — log at DEBUG level only, never INFO/WARN in production
- Call recordings are not a feature — no audio stored beyond the in-memory STT buffer

### Availability & Resilience
- Voice calls are synchronous and time-sensitive — OpenClaw unreachable mid-call must produce a graceful audio message, not silence or dead air
- Plugin must tolerate voice-app restarting without requiring OpenClaw gateway restart
- voice-app and OpenClaw run on separate servers — webhook URL must be configurable via env var

### Integration Constraints
- Plugin runs inside OpenClaw gateway process — all operations must be non-blocking (async/await only, no sync I/O)
- Webhook endpoint must be reachable from voice-app's network — configurable `OPENCLAW_WEBHOOK_URL` env var in voice-app

## Innovation & Differentiation

### Core Innovation: Reactive → Proactive Agents

Every other OpenClaw channel (Discord, Telegram, WhatsApp) is reactive — the agent waits for a message. Voice is the only channel where the agent can interrupt with urgency and the user can respond hands-free, without opening any app. `openclaw-sip-voice` is the first OpenClaw channel to enable agent-initiated contact.

**The shift:** An agent that can pick up the phone and call you is a collaborator, not a tool.

### Voice as Intelligent Medium Selector

Voice is intentionally low-bandwidth. The plugin treats this as a design constraint, not a limitation. When a response exceeds what speech can carry usefully (complex data, diffs, metrics), the agent delivers a brief voice summary and routes the full response to the user's active text channel. This is intelligent medium selection — agents choose the right channel for the content, not the other way around.

### First Self-Hosted SIP Channel for OpenClaw

Commercial voice AI services (Vapi, Twilio, Bland.ai, Hamming) are cloud-hosted, per-minute-billed, and reactive (they answer calls, they don't initiate them autonomously). None combine:
- Self-hosted SIP via VitalPBX / FreeSWITCH
- Multi-agent routing (each extension = a distinct agent)
- Cross-channel response delivery
- Agent-initiated outbound as a first-class capability
- OpenClaw's full intelligence layer (memory, tools, session management)

This plugin fills that gap — and reuses proven voice infrastructure rather than introducing new telephony primitives.

### Risk Analysis

| Risk | Mitigation |
|---|---|
| Spam / toll fraud via DID | `allowFrom` allowlist enforced before agent invocation; unknown callers rejected with configurable message |
| LLM latency → dead air | SIP re-INVITE to VitalPBX MOH during processing; caller hears music not silence |
| Session model confusion (voice vs agent lifecycle) | `endSession` terminates voice-app session only; OpenClaw workspace persists independently |
| Ecosystem lock-in | MIT-licensed, open source; bridge pattern keeps voice-app portable |
| OpenClaw API instability | Webhook contract versioned; bridge is single integration point — swap if API changes |

### MVP Validation Tests

| Test | Pass Criteria |
|---|---|
| Extension routing | Call 9000 → Morpheus answers; call 9001 → Cephanie answers |
| Isolation | Two simultaneous callers to 9000 never share context |
| Callback | Hue calls agent, delegates task, hangs up → agent calls back when done |
| Cross-channel | Response too long → brief voice summary + full text in Discord |
| Rejection | Unknown caller → rejection message, agent never invoked |
| Hold music | Agent processing >1s → caller hears MOH, not silence |

## Developer Tool Specific Requirements

### Project-Type Overview

`openclaw-sip-voice` is a Node.js plugin/infrastructure component — not an interactive developer tool, but a runtime integration layer. It targets developers installing and configuring the plugin, not end users building on top of its API. Developer experience (DX) centers on configuration clarity, actionable error messages, and minimal setup friction.

### Language & Runtime

| Component | Module System | Min Node.js |
|---|---|---|
| `voice-app/lib/openclaw-bridge.js` | CommonJS (required by drachtio ecosystem) | 18 LTS |
| `openclaw-sip-voice` plugin | CommonJS or ESM (match OpenClaw plugin loader) | 18 LTS |

No other language targets. No browser build. No TypeScript compilation step (plain JS, documented with JSDoc if needed).

### Installation Methods

**Plugin (OpenClaw side):**
```bash
openclaw plugins install openclaw-sip-voice
# or
npm install openclaw-sip-voice
```

**Bridge (voice-app side):**
1. `openclaw-bridge.js` is included in voice-app repo as a drop-in file
2. Set `BRIDGE_TYPE=openclaw` in `.env`
3. Set `OPENCLAW_WEBHOOK_URL` pointing to the plugin's webhook server

No build step. No native bindings. No post-install scripts.

### API Surface

#### Plugin → OpenClaw (channel plugin contract)
- `gateway.start(config)` — starts HTTP webhook server, registers SIP voice channel
- `gateway.on('message', handler)` — receives agent responses for voice delivery
- `outbound.sendText(accountId, text, options)` — triggers outbound call via voice-app

#### voice-app → Plugin (webhook)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/voice/query` | Route STT text to correct OpenClaw agent |
| POST | `/voice/end-session` | Notify plugin of voice session teardown |
| GET | `/voice/health` | Plugin liveness check |

#### Plugin → voice-app (outbound)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/outbound-call` | Initiate agent-initiated outbound call |

### Configuration Schema

**`devices.json` additions (voice-app side):**
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

**Plugin config (OpenClaw side):**
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

### Migration Guide (claude-bridge → openclaw-bridge)

For existing `claude-phone-vitalpbx` deployments switching from the default Claude bridge:

1. Add `openclaw-bridge.js` to `voice-app/lib/` (included in repo)
2. In `voice-app/.env`:
   ```
   BRIDGE_TYPE=openclaw
   OPENCLAW_WEBHOOK_URL=http://openclaw-server:47334
   OPENCLAW_API_KEY=your-api-key
   ```
3. In each device entry in `devices.json`, add `"accountId": "<agent-name>"`
4. Restart voice-app — no changes to drachtio, FreeSWITCH, or PBX config required

Existing `devices.json` structure is preserved. The bridge swap is backward-compatible at the SIP layer — VitalPBX config, IVR, DID routing are unchanged.

### Implementation Considerations

- All plugin code must be non-blocking (async/await, no sync I/O) — runs inside OpenClaw gateway process
- Error messages must be actionable: include what failed, what env var to check, what to do next
- Logs must distinguish voice-app events from OpenClaw events — prefix log lines with `[sip-voice]`
- No native dependencies — must install cleanly on Linux (VPS) without build tools
- Plugin should not crash OpenClaw gateway on startup failure — log error and degrade gracefully

## Functional Requirements

### Call Routing & Extension Management

- **FR1:** The system can route an inbound SIP call to the correct OpenClaw agent based on the dialed extension number
- **FR2:** An operator can configure multiple extensions, each bound to a distinct OpenClaw agent
- **FR3:** The system can register multiple SIP extensions with VitalPBX simultaneously and maintain those registrations across network interruptions
- **FR4:** The system can handle concurrent inbound calls to the same extension with fully isolated sessions (no context bleed between callers)

### Caller Authentication & Access Control

- **FR5:** The system can validate an inbound caller's phone number against a per-extension `allowFrom` allowlist before invoking an agent
- **FR6:** The system can reject calls from unknown callers with a configurable audio message, without invoking an agent
- **FR7:** An operator can configure `dmPolicy` per extension (`allowlist`, `pairing`, `open`) to control caller access rules
- **FR8:** The webhook endpoint can authenticate requests using an API key, rejecting unauthenticated requests with a 401 response

### Conversation & Session Management

- **FR9:** The system can pass a caller's phone number to the OpenClaw agent as `peerId` at call start
- **FR10:** The system can maintain a voice-app session (SIP dialog, audio fork, TTS cache) independently from the OpenClaw agent workspace
- **FR11:** The system can cleanly terminate a voice-app session on caller hangup without terminating the OpenClaw agent workspace
- **FR12:** The system can abort an in-flight OpenClaw query when the caller hangs up mid-processing
- **FR13:** The system can detect a caller's goodbye utterance and end the call cleanly

### Audio Processing & User Experience

- **FR14:** The system can transcribe caller speech to text using a configurable STT provider
- **FR15:** The system can synthesize agent responses to speech using a configurable TTS provider with per-agent voice selection
- **FR16:** The system can place a caller on hold (PBX music-on-hold via SIP re-INVITE) while the agent is processing a response
- **FR17:** The system can play a configurable audio message to the caller when the agent or integration is unavailable

### Outbound Calling

- **FR18:** An OpenClaw agent can initiate an outbound call to a phone number via the voice-app API
- **FR19:** An operator can trigger an outbound call programmatically via the voice-app REST API
- **FR20:** The system can resolve a caller identity via `identityLinks` config to a callback phone number for agent-initiated outbound

### Plugin Integration (OpenClaw Channel)

- **FR21:** The plugin can register as a SIP voice channel with the OpenClaw gateway
- **FR22:** The plugin can route an inbound voice query to the correct OpenClaw agent based on extension-to-`accountId` binding
- **FR23:** The plugin can receive agent responses and return them to the voice-app for TTS delivery
- **FR24:** The plugin can notify OpenClaw of voice session end without terminating the agent workspace
- **FR25:** The plugin can start and stop its webhook server independently of voice-app restarts
- **FR26:** An operator can install the plugin via OpenClaw's plugin manager or npm

### Configuration & Operations

- **FR27:** An operator can configure the bridge integration via environment variables (`BRIDGE_TYPE`, `OPENCLAW_WEBHOOK_URL`, `OPENCLAW_API_KEY`) without modifying source code
- **FR28:** An operator can configure per-extension accounts (extension, voiceId, authId, `allowFrom`, `accountId`) in a structured JSON config file
- **FR29:** An operator can configure agent bindings (extension → agent) in the OpenClaw plugin config
- **FR30:** An operator can configure identity links (user identity → phone number) for callback resolution
- **FR31:** The system can log events at appropriate severity levels, excluding caller phone numbers from INFO/WARN logs in production

## Non-Functional Requirements

### Performance

- **NFR-P1:** STT → OpenClaw agent → TTS round trip completes in under 5 seconds for typical queries under normal network conditions
- **NFR-P2:** Inbound calls are answered (SIP 200 OK) within 500ms of INVITE receipt
- **NFR-P3:** On-hold MOH is triggered within 1 second of dispatching the query to OpenClaw, preventing silent dead air
- **NFR-P4:** Voice-app handles up to 100 concurrent calls (bound by RTP port range 30000–30100) without call quality degradation

### Security

- **NFR-S1:** SIP registration credentials stored with chmod 600 permissions; never written to logs at any level
- **NFR-S2:** OpenClaw webhook API key passed via environment variable only — never in committed config files or log output
- **NFR-S3:** Caller phone numbers logged at DEBUG level only — excluded from INFO, WARN, and ERROR output in production
- **NFR-S4:** No call audio persisted beyond the in-memory STT buffer — zero recordings stored to disk
- **NFR-S5:** Webhook endpoint returns HTTP 401 for requests missing a valid API key, before any agent invocation
- **NFR-S6:** `dmPolicy: allowlist` is the mandatory default for any extension exposed to a DID/PSTN number

### Reliability

- **NFR-R1:** SIP registrations recover from network interruptions and re-register automatically, without manual intervention
- **NFR-R2:** Inbound calls answered correctly 100% of the time when voice-app process is running
- **NFR-R3:** OpenClaw unreachable mid-call produces a graceful audio message to the caller within 3 seconds — no silence or dead air
- **NFR-R4:** Plugin re-registers with OpenClaw gateway on voice-app restart without requiring OpenClaw gateway restart
- **NFR-R5:** Caller hangup terminates all in-flight query processing and releases session resources within 5 seconds

### Integration

- **NFR-I1:** Webhook URL (`OPENCLAW_WEBHOOK_URL`), API key, and voice-app URL are fully configurable via environment variables — no hardcoded addresses
- **NFR-I2:** Bridge interface (`query`, `endSession`, `isAvailable`) is drop-in compatible with `claude-bridge.js` — voice-app requires no structural changes beyond `BRIDGE_TYPE` env var
- **NFR-I3:** All plugin and bridge operations are non-blocking (async/await only) — no synchronous I/O in the OpenClaw gateway event loop
- **NFR-I4:** Plugin installs without native build dependencies on a standard Linux VPS — no node-gyp, no compiler required

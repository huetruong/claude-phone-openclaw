---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# claude-phone-vitalpbx - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for claude-phone-vitalpbx, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Call Routing & Extension Management**

FR1: The system can route an inbound SIP call to the correct OpenClaw agent based on the dialed extension number
FR2: An operator can configure multiple extensions, each bound to a distinct OpenClaw agent
FR3: The system can register multiple SIP extensions with the PBX simultaneously and maintain those registrations across network interruptions
FR4: The system can handle concurrent inbound calls to the same extension with fully isolated sessions (no context bleed between callers)

**Caller Authentication & Access Control**

FR5: The system can validate an inbound caller's phone number against a per-extension `allowFrom` allowlist before invoking an agent
FR6: The system can reject calls from unknown callers (not in `allowFrom`) with a silent hangup, without invoking an agent
FR7: ~~An operator can configure `dmPolicy` per extension (`allowlist`, `pairing`, `open`) to control caller access rules~~ **REMOVED** — `allowFrom` empty/missing = allow all is sufficient; no separate `dmPolicy` field needed (Story 3.2 code review decision)
FR8: The webhook endpoint can authenticate requests using an API key, rejecting unauthenticated requests with a 401 response

**Conversation & Session Management**

FR9: The system can pass a caller's phone number to the OpenClaw agent as `peerId` at call start
FR10: The system can maintain a voice-app session (SIP dialog, audio fork, TTS cache) independently from the OpenClaw agent workspace
FR11: The system can cleanly terminate a voice-app session on caller hangup without terminating the OpenClaw agent workspace
FR12: The system can abort an in-flight OpenClaw query when the caller hangs up mid-processing
FR13: The system can detect a caller's goodbye utterance and end the call cleanly

**Audio Processing & User Experience**

FR14: The system can transcribe caller speech to text using a configurable STT provider
FR15: The system can synthesize agent responses to speech using a configurable TTS provider with per-agent voice selection
FR16: The system can place a caller on hold (PBX music-on-hold via SIP re-INVITE) while the agent is processing a response
FR17: The system can play a configurable audio message to the caller when the agent or integration is unavailable

**Outbound Calling**

FR18: An OpenClaw agent can initiate an outbound call to a phone number via the voice-app API
FR19: An operator can trigger an outbound call programmatically via the voice-app REST API
FR20: The system can resolve a caller identity via `identityLinks` config to a callback phone number for agent-initiated outbound
FR32: The plugin registers a `place_call` tool and `SKILL.md` so OpenClaw agents can autonomously initiate outbound calls with awareness of when and how to use the capability
FR33: When a voice response exceeds what speech can carry usefully, the agent delivers a brief voice summary and routes the full response to the user's active primary channel (Discord, Telegram, Slack)

**Plugin Integration (OpenClaw Channel)**

FR21: The plugin can register as a SIP voice channel with the OpenClaw gateway
FR22: The plugin can route an inbound voice query to the correct OpenClaw agent based on extension-to-`accountId` binding
FR23: The plugin can receive agent responses and return them to the voice-app for TTS delivery
FR24: The plugin can notify OpenClaw of voice session end without terminating the agent workspace
FR25: The plugin can start and stop its webhook server independently of voice-app restarts
FR26: An operator can install the plugin via OpenClaw's plugin manager or npm

**Configuration & Operations**

FR27: An operator can configure the bridge integration via environment variables (`BRIDGE_TYPE`, `OPENCLAW_WEBHOOK_URL`, `OPENCLAW_API_KEY`) without modifying source code
FR28: An operator can configure per-extension accounts (extension, voiceId, authId, `allowFrom`, `accountId`) in a structured JSON config file
FR29: An operator can configure agent bindings (extension → agent) in the OpenClaw plugin config
FR30: An operator can configure identity links (user identity → phone number) for callback resolution
FR31: The system can log events at appropriate severity levels, excluding caller phone numbers from INFO/WARN logs in production

### NonFunctional Requirements

**Performance**

NFR-P1: STT → OpenClaw agent → TTS round trip completes in under 5 seconds for typical queries under normal network conditions
NFR-P2: Inbound calls are answered (SIP 200 OK) within 500ms of INVITE receipt
NFR-P3: On-hold MOH is triggered within 1 second of dispatching the query to OpenClaw, preventing silent dead air
NFR-P4: Voice-app handles up to 100 concurrent calls (bound by RTP port range 30000–30100) without call quality degradation

**Security**

NFR-S1: SIP registration credentials stored with chmod 600 permissions; never written to logs at any level
NFR-S2: OpenClaw webhook API key passed via environment variable only — never in committed config files or log output
NFR-S3: Caller phone numbers logged at DEBUG level only — excluded from INFO, WARN, and ERROR output in production
NFR-S4: No call audio persisted beyond the in-memory STT buffer — zero recordings stored to disk
NFR-S5: Webhook endpoint returns HTTP 401 for requests missing a valid API key, before any agent invocation
NFR-S6: Any extension exposed to a DID/PSTN number MUST configure a non-empty `allowFrom` list — an empty or missing `allowFrom` allows all callers through

**Reliability**

NFR-R1: SIP registrations recover from network interruptions and re-register automatically, without manual intervention
NFR-R2: Inbound calls answered correctly 100% of the time when voice-app process is running
NFR-R3: OpenClaw unreachable mid-call produces a graceful audio message to the caller within 3 seconds — no silence or dead air
NFR-R4: Plugin re-registers with OpenClaw gateway on voice-app restart without requiring OpenClaw gateway restart
NFR-R5: Caller hangup terminates all in-flight query processing and releases session resources within 5 seconds

**Integration**

NFR-I1: Webhook URL (`OPENCLAW_WEBHOOK_URL`), API key, and voice-app URL are fully configurable via environment variables — no hardcoded addresses
NFR-I2: Bridge interface (`query`, `endSession`, `isAvailable`) is drop-in compatible with `claude-bridge.js` — voice-app requires no structural changes beyond `BRIDGE_TYPE` env var
NFR-I3: All plugin and bridge operations are non-blocking (async/await only) — no synchronous I/O in the OpenClaw gateway event loop
NFR-I4: Plugin installs without native build dependencies on a standard Linux VPS — no node-gyp, no compiler required

**Configuration**

NFR-C1: `allowFrom` phone numbers stored in `devices.json` MUST be in E.164 format — ensures exact-match validation against the SIP caller ID delivered by the PBX
NFR-C2: The CLI (`claude-phone device add`) MUST accept `allowFrom` entries in any international format and normalize to E.164 using `libphonenumber-js` at config-write time; invalid numbers are rejected before saving
NFR-C3: A `region.defaultCountry` (ISO 3166-1 alpha-2) MUST be configured during `claude-phone setup` and used as the fallback country for national-format phone number parsing; defaults to `US`

### Additional Requirements

- **Brownfield foundation**: No starter template — existing drachtio + FreeSWITCH + FreePBX codebase is the base; voice-app changes are minimal (one new file: `openclaw-bridge.js`)
- **Bridge loader**: `BRIDGE_TYPE` env var selects bridge at runtime (`const bridge = require('./lib/${bridgeType}-bridge')`) — one env var, one require() line, no new files in voice-app beyond the bridge itself
- **Plugin API contract**: OpenClaw plugin API uses `api.registerService()` for service plugins — NOT `api.registerChannel()` (requires full ChannelPlugin interface). Deployment-confirmed. See `docs/openclaw-plugin-architecture.md`.
- **CommonJS only**: Both `voice-app` and `openclaw-plugin` must use CommonJS (`require`/`module.exports`) — ESM breaks the drachtio ecosystem
- **Async discipline**: All plugin code must be non-blocking (async/await, `fs.promises`) — synchronous I/O blocks all agents on the OpenClaw gateway event loop
- **Bridge interface (MANDATORY)**: `openclaw-bridge.js` must export exactly `{ query(prompt, callId, deviceConfig), endSession(callId), isAvailable() }` — no additional exports, no renamed methods, no changed signatures
- **HTTP contract (MANDATORY)**: Exact JSON shapes for all 4 endpoints specified in architecture; agents must not deviate
- **Session key**: `callId` = drachtio `callUuid` (UUID v4, lowercase, hyphenated) — passed verbatim, never transformed or hashed
- **Logging discipline**: All plugin log lines prefixed `[sip-voice]`; caller phone numbers at DEBUG only, never INFO/WARN/ERROR
- **Stale call cleanup**: On plugin startup, mark all non-terminal call state as ended (matches voice-call plugin `staleCallReaperSeconds` pattern)
- **Plugin manifest**: `openclaw.plugin.json` required fields: `id`, `version`, `name`, `description`, `main`, `configSchema`
- **Error handling**: Plugin unreachable → voice-app logs error and plays configurable unavailability message; no retry (voice is time-sensitive); Express route handlers must never propagate uncaught errors; return HTTP 503 on OpenClaw failure
- **Documentation**: Two new docs required: `docs/freepbx-setup.md` (FreePBX + BulkVS trunk setup) and `docs/openclaw-plugin-setup.md` (plugin install + config guide)
- **No native deps**: Plugin must install on standard Linux VPS without node-gyp or build tools
- **Session state**: In-memory Map only (no persistence; OpenClaw bug #3290 makes persistence valueless at this time)
- **New files (voice-app)**: `voice-app/lib/openclaw-bridge.js` only — all other voice-app files unchanged
- **New files (plugin)**: `openclaw-plugin/src/index.js`, `webhook-server.js`, `session-store.js`, `auth.js`, `logger.js`

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 1 | Route inbound call to correct agent by extension |
| FR2 | Epic 2 | Configure multiple extensions with distinct agents |
| FR3 | Epic 2 | Multi-extension SIP registration (brownfield) |
| FR4 | Epic 2 | Concurrent isolated sessions |
| FR5 | Epic 3 | Validate caller against allowFrom allowlist |
| FR6 | Epic 3 | Reject unknown callers (not in allowFrom) — silent hangup |
| FR7 | ~~Epic 3~~ | ~~Configure dmPolicy per extension~~ **REMOVED** |
| FR8 | Epic 1 | Webhook API key authentication |
| FR9 | Epic 1 | Pass caller phone number as peerId |
| FR10 | Epic 4 | Independent voice/agent sessions |
| FR11 | Epic 4 | Clean voice-app termination on hangup |
| FR12 | Epic 4 | Abort in-flight query on hangup |
| FR13 | Epic 4 | Goodbye utterance detection (brownfield) |
| FR14 | Epic 1 | STT transcription (brownfield) |
| FR15 | Epic 1 | TTS with per-agent voice (brownfield) |
| FR16 | Epic 4 | MOH during agent processing (brownfield) |
| FR17 | Epic 4 | Unavailability audio message |
| FR18 | Epic 5 | Agent-initiated outbound call |
| FR19 | Epic 5 | API-triggered outbound call |
| FR20 | Epic 5 | Identity resolution via identityLinks |
| FR21 | Epic 1 | Register SIP voice channel with OpenClaw |
| FR34 | Epic 5 | Dynamic greeting — agent controls opening of every call via initial bridge query; hold music plays during generation |
| FR35 | Epic 5 | Call continuity — agent greets returning callers by name and references last conversation context |
| FR36 | Epic 5 | First-call identity enrollment — agent detects unlinked callers, runs enrollment conversation, writes identityLinks entry dynamically via `link_identity` tool |
| FR22 | Epic 1 | Route voice query to correct agent |
| FR23 | Epic 1 | Receive and return agent responses |
| FR24 | Epic 4 | Notify OpenClaw of session end |
| FR25 | Epic 4 | Independent webhook server lifecycle |
| FR26 | Epic 2 | Plugin install via OpenClaw or npm |
| FR27 | Epic 1 | Env var bridge configuration |
| FR28 | Epic 2 | Per-extension device config (devices.json) |
| FR29 | Epic 2 | Agent bindings in plugin config |
| FR30 | Epic 5 | Identity link configuration |
| FR31 | Epic 4 | PII-safe logging at appropriate levels |
| FR32 | Epic 5 | place_call tool + SKILL.md agent skill registration |
| FR33 | Epic 5 | Cross-channel response delivery (brief voice + full text in primary channel) |

## Epic List

### Epic 1: Inbound Call to OpenClaw Agent
An operator can install the plugin, configure the bridge, call an extension, and talk to their OpenClaw agent — hearing the agent's response spoken back.
**FRs covered:** FR1, FR8, FR9, FR14, FR15, FR21, FR22, FR23, FR27

### Epic 2: Multi-Agent Routing & Configuration
An operator can configure multiple extensions, each bound to a distinct agent, with structured config files. Speed-dial 9000 for Morpheus, 9001 for Cephanie — routing is deterministic.
**FRs covered:** FR2, FR3, FR4, FR26, FR28, FR29

### Epic 3: Caller Access Control
Only trusted callers reach agents. Unknown callers are silently disconnected. Operators configure `allowFrom` per extension — empty means open, populated means allowlist-only.
**FRs covered:** FR5, FR6

### Epic 4: Call Quality & Session Lifecycle
Calls are smooth — hold music plays during agent processing (no dead air), hangups are clean, in-flight queries are aborted, sessions don't orphan, errors produce graceful audio messages, and logging is PII-safe.
**FRs covered:** FR10, FR11, FR12, FR13, FR16, FR17, FR24, FR25, FR31

### Epic 5: Outbound Calling, Identity & Dynamic Greeting
Agents can initiate calls to users (callbacks after task completion), operators can trigger outbound calls via API, callers are recognized by name on every call with the agent greeting them personally and picking up the last conversation thread, new callers are enrolled dynamically on first call without any manual config, and agents use voice as an intelligent medium selector — brief summaries on the call, full detail in the primary channel.
**FRs covered:** FR18, FR19, FR20, FR30, FR32, FR33, FR34, FR35, FR36

## Epic 1: Inbound Call to OpenClaw Agent

An operator can install the plugin, configure the bridge, call an extension, and talk to their OpenClaw agent — hearing the agent's response spoken back.

### Story 1.1: Plugin Scaffold & Channel Registration

As an operator,
I want to install the OpenClaw SIP voice plugin and have it register as a channel,
So that OpenClaw recognizes SIP voice as an available communication channel.

**Acceptance Criteria:**

**Given** the `openclaw-plugin/` directory contains a valid `openclaw.plugin.json` manifest with fields `id`, `version`, `name`, `description`, `main`, `configSchema`
**When** the operator runs `openclaw plugins install -l ./openclaw-plugin`
**Then** OpenClaw loads the plugin without errors and the SIP voice channel appears in the registered channels list

**Given** the plugin entry point (`src/index.js`) exports a `register(api)` function and calls `api.registerService()` on initialization
**When** the OpenClaw gateway starts
**Then** the plugin starts its webhook server and logs `[sip-voice] loaded N account bindings` at INFO level
*(Correction 2026-02-24: original spec said `api.registerChannel()` — incorrect. SIP voice is a service plugin. `api.registerChannel()` requires a full ChannelPlugin interface. Correct pattern is `api.registerService()`. See `docs/openclaw-plugin-architecture.md`.)*

**Given** the plugin uses CommonJS (`require`/`module.exports`) and contains no synchronous I/O
**When** the plugin loads inside the OpenClaw gateway event loop
**Then** no blocking operations occur and all other channels continue functioning normally

**Given** the plugin includes `src/logger.js`
**When** any plugin component logs a message
**Then** the log line is prefixed with `[sip-voice]`

### Story 1.2: Webhook Server & API Key Authentication

As an operator,
I want the plugin to expose a secure webhook server that rejects unauthenticated requests,
So that only my authorized voice-app can communicate with the plugin.

**Acceptance Criteria:**

**Given** the plugin config specifies `webhookPort: 47334` and `apiKey: "test-key"`
**When** the plugin starts
**Then** an Express HTTP server listens on port 47334 and logs `[sip-voice] webhook server listening on port 47334`

**Given** a request arrives at any plugin endpoint without an `Authorization` header
**When** the auth middleware processes the request
**Then** the server returns HTTP 401 with no further processing (no agent invocation)

**Given** a request arrives with `Authorization: Bearer wrong-key`
**When** the auth middleware processes the request
**Then** the server returns HTTP 401

**Given** a request arrives with `Authorization: Bearer test-key`
**When** the auth middleware processes the request
**Then** the request is passed through to the route handler

**Given** the webhook server is running
**When** a GET request is sent to `/voice/health`
**Then** the server returns HTTP 200 with body `{ "ok": true }`

**Given** the plugin includes `src/session-store.js` with an in-memory Map
**When** the plugin starts
**Then** the session store is initialized as an empty Map and any stale sessions from prior runs are cleared

### Story 1.3: Voice Query Routing

As a caller,
I want my spoken words routed to the correct OpenClaw agent and the agent's response returned,
So that I can have a conversation with my agent over the phone.

**Acceptance Criteria:**

**Given** a valid authenticated POST request to `/voice/query` with body `{ "prompt": "hello", "callId": "uuid-1", "accountId": "morpheus", "peerId": "+15551234567" }`
**When** the webhook server processes the request
**Then** the plugin routes the query to the OpenClaw agent bound to `accountId` "morpheus", passes `peerId` for caller identity, and returns HTTP 200 with body `{ "response": "<agent reply>" }`

**Given** the `callId` is a new UUID not seen before
**When** the first `/voice/query` request arrives for that `callId`
**Then** the session store creates a new session mapping (`callId` → `sessionId`) and the OpenClaw agent starts a new session

**Given** the `callId` already has an active session in the store
**When** a subsequent `/voice/query` request arrives with the same `callId`
**Then** the plugin resumes the existing OpenClaw session (no new session created)

**Given** a valid authenticated POST request to `/voice/end-session` with body `{ "callId": "uuid-1" }`
**When** the webhook server processes the request
**Then** the session store removes the `callId` mapping and returns HTTP 200 with `{ "ok": true }`
**And** the OpenClaw agent workspace is NOT terminated (voice-app session only)

**Given** the `peerId` (caller phone number) is included in the query
**When** the plugin logs the request
**Then** `peerId` appears only at DEBUG level, never at INFO/WARN/ERROR

**Given** the OpenClaw agent is unreachable or returns an error
**When** the plugin attempts to route a query
**Then** the plugin returns HTTP 503 with `{ "error": "agent unavailable" }` and logs the error at ERROR level with `[sip-voice]` prefix

### Story 1.4: OpenClaw Bridge & Bridge Loader

As an operator,
I want to switch from the Claude bridge to the OpenClaw bridge via a single env var,
So that my existing voice-app routes calls through OpenClaw instead of Claude CLI.

**Acceptance Criteria:**

**Given** `voice-app/lib/openclaw-bridge.js` exists and exports `{ query, endSession, isAvailable }`
**When** the bridge module is loaded
**Then** the exported interface is identical to `claude-bridge.js` — same method names, same parameter signatures: `query(prompt, callId, deviceConfig)`, `endSession(callId)`, `isAvailable()`

**Given** `BRIDGE_TYPE=openclaw`, `OPENCLAW_WEBHOOK_URL=http://host:47334`, and `OPENCLAW_API_KEY=test-key` are set in the environment
**When** `query(prompt, callId, deviceConfig)` is called
**Then** the bridge sends `POST /voice/query` to `OPENCLAW_WEBHOOK_URL` with body `{ "prompt": prompt, "callId": callId, "accountId": deviceConfig.accountId, "peerId": deviceConfig.peerId }`, `Authorization: Bearer <OPENCLAW_API_KEY>`, and returns `{ response: "<agent reply>" }`

**Given** `BRIDGE_TYPE=openclaw` is set
**When** `endSession(callId)` is called
**Then** the bridge sends `POST /voice/end-session` to `OPENCLAW_WEBHOOK_URL` with body `{ "callId": callId }` and `Authorization: Bearer <OPENCLAW_API_KEY>`

**Given** `BRIDGE_TYPE=openclaw` is set
**When** `isAvailable()` is called
**Then** the bridge sends `GET /voice/health` to `OPENCLAW_WEBHOOK_URL` and returns `true` if HTTP 200, `false` otherwise

**Given** the voice-app bridge loader reads `BRIDGE_TYPE` from the environment
**When** `BRIDGE_TYPE=openclaw`
**Then** `openclaw-bridge.js` is loaded via `require('./lib/openclaw-bridge')`
**And** when `BRIDGE_TYPE=claude` (or unset), `claude-bridge.js` is loaded (existing behavior preserved)

**Given** the bridge uses CommonJS (`require`/`module.exports`) and all HTTP calls are async
**When** loaded in the voice-app process
**Then** no synchronous I/O occurs and the existing STT/TTS pipeline (FR14, FR15) continues to function unchanged

## Epic 2: Multi-Agent Routing & Configuration

An operator can configure multiple extensions, each bound to a distinct agent, with structured config files. Speed-dial 9000 for Morpheus, 9001 for Cephanie — routing is deterministic.

### Story 2.1: Device Configuration with accountId

As an operator,
I want to add an `accountId` field to each device in `devices.json` that maps to an OpenClaw agent,
So that each SIP extension is bound to a specific agent.

**Acceptance Criteria:**

**Given** `devices.json` contains a device entry with `"extension": "9000"` and `"accountId": "morpheus"`
**When** the voice-app loads device configuration
**Then** the `accountId` field is available on the device config object passed to the bridge's `query()` method

**Given** `devices.json` contains multiple device entries each with a unique `accountId`
**When** an inbound call arrives on extension 9000
**Then** the bridge reads `deviceConfig.accountId` as `"morpheus"` and includes it in the `POST /voice/query` body

**Given** `devices.json` contains a device entry without an `accountId` field
**When** the voice-app loads configuration
**Then** the system logs a warning and the device falls back to using the `name` field as `accountId` (backward compatible)

**Given** the `accountId` field is documented in `devices.json`
**When** an operator reviews the config
**Then** the field purpose and format are clear from the existing device entry examples

### Story 2.2: Plugin Agent Bindings & Multi-Extension Routing

As an operator,
I want to configure agent bindings in the plugin config so each extension routes to its specific agent,
So that calling 9000 always reaches Morpheus and 9001 always reaches Cephanie.

**Acceptance Criteria:**

**Given** the plugin config contains `accounts: [{ id: "morpheus", extension: "9000" }, { id: "cephanie", extension: "9001" }]` and `bindings: [{ accountId: "morpheus", agentId: "morpheus" }, { accountId: "cephanie", agentId: "cephanie" }]`
**When** the plugin starts
**Then** the plugin loads all account and binding entries and logs `[sip-voice] loaded 2 account bindings`

**Given** a `POST /voice/query` arrives with `"accountId": "morpheus"`
**When** the plugin resolves the binding
**Then** the query is routed to the OpenClaw agent with `agentId` "morpheus"

**Given** a `POST /voice/query` arrives with `"accountId": "cephanie"`
**When** the plugin resolves the binding
**Then** the query is routed to the OpenClaw agent with `agentId` "cephanie"

**Given** a `POST /voice/query` arrives with an `accountId` that has no configured binding
**When** the plugin attempts to resolve the binding
**Then** the plugin returns HTTP 404 with `{ "error": "no agent binding for accountId" }` and logs at WARN level

**Given** the plugin config includes a `configSchema` in `openclaw.plugin.json`
**When** the operator installs the plugin via `openclaw plugins install -l ./openclaw-plugin` or `npm install openclaw-sip-voice`
**Then** the plugin installs without errors and validates the config schema on startup

### Story 2.3: Concurrent Session Isolation

As a caller,
I want my call to be fully isolated from other callers on the same extension,
So that two simultaneous calls to extension 9000 never share context.

**Acceptance Criteria:**

**Given** two callers dial extension 9000 simultaneously, each receiving a unique `callId` from drachtio
**When** both calls send `POST /voice/query` to the plugin
**Then** the session store creates two separate `callId` → `sessionId` mappings and each query is routed to an independent OpenClaw session

**Given** caller A and caller B both have active sessions on extension 9000
**When** caller A sends a message referencing prior conversation context
**Then** caller A's response reflects only caller A's session history, with no data from caller B's session

**Given** caller A hangs up while caller B is still on the line
**When** `POST /voice/end-session` is sent for caller A's `callId`
**Then** only caller A's session mapping is removed; caller B's session continues unaffected

**Given** the multi-registrar (`multi-registrar.js`) registers extensions 9000 and 9001 with the PBX
**When** a network interruption occurs and recovers
**Then** both registrations re-establish automatically without manual intervention (FR3 brownfield verified)

### Story 2.4: CLI Device Add accountId Support

As an operator,
I want the `claude-phone device add` command to prompt for an `accountId` field,
So that new devices are OpenClaw-ready without manual JSON editing.

**Acceptance Criteria:**

**Given** the operator runs `claude-phone device add`
**When** the interactive prompts are presented
**Then** a new prompt asks for `accountId` after the existing fields, defaulting to the device `name` if left blank

**Given** the operator provides an `accountId` value during `device add`
**When** the device is saved to `~/.claude-phone/config.json`
**Then** the device object includes `"accountId": "<value>"` alongside the existing fields

**Given** the operator leaves `accountId` blank during `device add`
**When** the device is saved
**Then** the device object includes `"accountId": "<name>"` using the device name as fallback (consistent with Story 2.1 voice-app fallback behavior)

**Given** the operator runs `claude-phone device list`
**When** the device table is displayed
**Then** the table includes an `Account ID` column showing each device's `accountId` value

**Given** `devices.json` is generated or updated from CLI config
**When** the docker config is written
**Then** each device entry in `devices.json` includes the `accountId` field from the CLI config

## Epic 3: Caller Access Control

Only trusted callers reach agents. Unknown callers are disconnected. The operator controls access policy per extension.

### Story 3.1: Caller Allowlist Validation

As an operator,
I want inbound calls validated against a per-extension `allowFrom` allowlist before any agent is invoked,
So that only trusted phone numbers can reach my agents.

**Acceptance Criteria:**

**Given** `devices.json` contains a device with `"extension": "9000"` and `"allowFrom": ["+12024561234", "+12024569876"]`
**When** an inbound call arrives on extension 9000 from caller ID `+12024561234`
**Then** the caller ID matches the `allowFrom` list and the call proceeds to the bridge for agent routing

**Given** an inbound call arrives on extension 9000 from caller ID `+12025550000` which is NOT in the `allowFrom` list
**When** the voice-app checks the caller ID
**Then** the call is rejected before the bridge `query()` method is ever called — the agent is never invoked

**Given** the `allowFrom` check occurs in the voice-app before any bridge interaction
**When** a call is rejected
**Then** no HTTP request is sent to the plugin webhook and no OpenClaw session is created

**Given** the caller's phone number is checked during validation
**When** the result is logged
**Then** the phone number appears only at DEBUG level, never at INFO/WARN/ERROR (NFR-S3)

**Given** an operator runs `claude-phone device add` and enters `allowFrom` numbers in any international format (e.g. `(202) 456-1234` or `+44 20 7946 0958`)
**When** the CLI saves the device configuration
**Then** the numbers are normalized to E.164 format in `devices.json` using the operator's configured `region.defaultCountry` (NFR-C1, NFR-C2)

**Given** an operator runs `claude-phone setup`
**When** completing the Regional Settings step
**Then** a `region.defaultCountry` (ISO 3166-1 alpha-2) is saved to config and used as the fallback country for phone number parsing (NFR-C3)

### Story 3.2: Unknown Caller Rejection

As an operator,
I want unknown callers to be disconnected immediately,
So that spammers and unauthorized callers never reach my agents.

> **Design decision (Story 3.2 code review):** `dmPolicy` field removed — `allowFrom` empty/missing = allow all callers is sufficient and simpler. No separate policy field needed.

**Acceptance Criteria:**

**Given** an inbound call from an unknown caller (not in `allowFrom`) arrives on an extension with a populated `allowFrom` list
**When** the voice-app rejects the call
**Then** the call is disconnected immediately (silent hangup) — no agent invoked, no session created

**Given** `allowFrom` is empty or not set for an extension
**When** any caller dials that extension
**Then** all callers are accepted (no restriction configured — NFR-S6: DID-exposed extensions MUST configure `allowFrom`)

**Given** a call is rejected due to allowlist enforcement
**When** the rejection occurs
**Then** the event is logged at INFO level as `[sip-voice] call rejected: unknown caller on extension <ext>` (without the phone number)

## Epic 4: Call Quality & Session Lifecycle

Calls are smooth — hold music plays during agent processing (no dead air), hangups are clean, in-flight queries are aborted, sessions don't orphan, errors produce graceful audio messages, and logging is PII-safe.

### Story 4.1: Independent Session Lifecycle

As a caller,
I want my voice session to be independent from the OpenClaw agent workspace,
So that hanging up ends my call without destroying the agent's memory or context.

**Acceptance Criteria:**

**Given** a caller is in an active call on extension 9000 with an established OpenClaw session
**When** the caller hangs up
**Then** the voice-app tears down the SIP dialog, audio fork, and TTS cache for that call

**Given** a caller hangs up and the voice-app session is torn down
**When** the bridge calls `endSession(callId)`
**Then** the bridge sends `POST /voice/end-session` to the plugin with `{ "callId": "<uuid>" }` and the plugin removes the `callId` → `sessionId` mapping from the session store

**Given** the plugin receives a `POST /voice/end-session` request
**When** the session mapping is removed
**Then** the OpenClaw agent workspace (memory, files, session history) is NOT terminated — only the voice-app session ends

**Given** the same caller calls extension 9000 again after a previous call ended
**When** the new call arrives
**Then** a new `callId` is generated and a new session mapping is created, but the OpenClaw agent retains context from prior sessions (agent persistence is an OpenClaw-side behavior)

### Story 4.2: In-Flight Query Abort on Hangup

As a caller,
I want the system to stop processing my query if I hang up mid-conversation,
So that no orphaned sessions or wasted processing accumulate.

**Acceptance Criteria:**

**Given** a caller's speech has been transcribed and the bridge has sent `POST /voice/query` to the plugin
**When** the caller hangs up before the plugin returns a response
**Then** the voice-app aborts the in-flight HTTP request to the plugin

**Given** the plugin receives an aborted connection mid-processing
**When** the Express request is terminated
**Then** the plugin handles the abort gracefully — no uncaught errors, no crashed route handlers

**Given** a caller hangs up mid-processing
**When** the voice-app detects the BYE signal
**Then** all session resources (SIP dialog, audio fork, TTS cache, pending HTTP request) are released within 5 seconds (NFR-R5)

**Given** a caller hangs up and the in-flight query is aborted
**When** cleanup completes
**Then** the bridge calls `endSession(callId)` to notify the plugin, and the session store removes the mapping

### Story 4.3: Hold Music & Unavailability Message

As a caller,
I want to hear hold music while the agent is thinking, and a clear message if the agent is unavailable,
So that I never experience dead air or confusion during a call.

**Acceptance Criteria:**

**Given** the bridge has dispatched a query to the plugin and is awaiting a response
**When** processing begins
**Then** the voice-app triggers MOH via SIP re-INVITE (`a=sendonly`) within 1 second of dispatching the query (NFR-P3), and the caller hears PBX hold music instead of silence

**Given** MOH is playing and the plugin returns a response
**When** the bridge receives the response
**Then** MOH is stopped (SIP re-INVITE `a=sendrecv`) and the TTS-rendered agent response is played to the caller

**Given** the plugin webhook is unreachable (network error, plugin down)
**When** the bridge's `isAvailable()` returns `false` or `query()` fails with a connection error
**Then** the voice-app plays a configurable audio unavailability message to the caller (e.g., "The agent is currently unavailable. Please try again later.")

**Given** the plugin returns HTTP 503 (`{ "error": "agent unavailable" }`)
**When** the bridge processes the error response
**Then** the voice-app plays the configurable unavailability message to the caller and logs the error at ERROR level

**Given** MOH and unavailability message handling exist in the brownfield voice-app
**When** the bridge is swapped from claude-bridge to openclaw-bridge
**Then** MOH and error message flows continue to function identically (FR16 brownfield verified)

### Story 4.4: Plugin Lifecycle & PII-Safe Logging

As an operator,
I want the plugin webhook server to start and stop independently of voice-app restarts, and all logs to be PII-safe,
So that I can maintain the system without coordinated restarts and without leaking caller data.

**Acceptance Criteria:**

**Given** the plugin webhook server is running and the voice-app restarts
**When** the voice-app comes back online and sends requests to the plugin
**Then** the plugin processes requests normally without requiring its own restart (FR25)

**Given** the voice-app is running and the OpenClaw gateway (including plugin) restarts
**When** the plugin webhook server comes back online
**Then** the voice-app's next `GET /voice/health` check detects the plugin is available again and resumes normal query routing

**Given** any plugin component logs a message that includes a caller phone number
**When** the log level is INFO, WARN, or ERROR
**Then** the phone number is excluded from the log output (NFR-S3)
**And** the phone number is only included at DEBUG level

**Given** all plugin log output
**When** any message is logged
**Then** the log line is prefixed with `[sip-voice]` (FR31)

**Given** the goodbye detection feature exists in the brownfield voice-app
**When** the caller says "goodbye" or similar farewell phrases
**Then** the call ends cleanly through the same flow as a manual hangup — bridge `endSession()` is called and session is cleaned up (FR13 brownfield verified)

## Epic 5: Outbound Calling, Identity & Dynamic Greeting

Agents can initiate calls to users (callbacks after task completion), operators can trigger outbound calls via API, callers are recognized and greeted by name on every call with the agent referencing the last conversation, new callers self-enroll on first call, and agents use voice as an intelligent medium selector.

> **Design principle (verified 2026-02-24):** Two call modes — choose the right one:
> - **`announce`**: Brief, one-way. Speak like you'd leave a voicemail — one clear thought, then let the channel carry the rest.
> - **`conversation`**: Two-way, interactive. Use when the user needs to give instructions, ask questions, or make decisions in real time. This is a real phone call — let it breathe.

### Story 5.1: Plugin-Triggered Outbound Calls

As an OpenClaw agent,
I want to trigger an outbound call from the plugin to the voice-app,
So that I can call users back after completing a task.

**Acceptance Criteria:**

**Given** the plugin needs to initiate an outbound call to a user
**When** the plugin sends `POST /api/outbound-call` to the voice-app with body `{ "to": "12125550100", "device": "9000", "message": "Your task is complete." }`
**Then** the voice-app initiates a SIP call to the specified phone number using the agent's configured extension and voice

> **Note — conversation mode:** The outbound handler supports `mode: "announce"` (one-way, default) and `mode: "conversation"` (two-way back-and-forth). Conversation mode uses `runConversationLoop` — the same function as inbound calls — so it works with the OpenClaw bridge automatically. No additional work needed.

> **Note (verified 2026-02-24):** Use `device` (extension number or device name, e.g. `"9000"` or `"morpheus"`) — NOT `accountId`. The `device` param is used to look up the entry in `devices.json` for SIP credentials and `voiceId`. `accountId` is ignored by the outbound route. Phone number should be passed without `+` prefix (e.g. `"12125550100"`) — the `+` prefix triggers a `9` PSTN dial prefix in the outbound handler.

**Given** the outbound call is answered by the recipient
**When** the call connects
**Then** the voice-app synthesizes the `message` text via TTS using the agent's configured `voiceId` and plays it to the recipient

**Given** an operator wants to trigger an outbound call directly
**When** the operator sends `POST /api/outbound-call` to the voice-app REST API with the same body format
**Then** the call is initiated identically to a plugin-triggered call (FR19 — same endpoint, same behavior)

**Given** the plugin attempts to trigger an outbound call but the voice-app is unreachable
**When** the HTTP request fails
**Then** the plugin logs the error at ERROR level with `[sip-voice]` prefix and does not crash — the error is reported back to the OpenClaw agent

**Given** the outbound call is initiated with `device: "9000"`
**When** the voice-app looks up the device config
**Then** the call uses Morpheus's SIP credentials, extension, and voice settings from `devices.json`

### Story 5.2: Dynamic Identity Enrollment — FR36

As a caller who is new to the system,
I want the agent to recognize I'm a first-time caller and guide me through a quick enrollment,
So that future calls know who I am and share my session context across all my channels — without the operator needing to manually configure anything.

**Design notes:**
- `allowFrom` in `devices.json` remains the security gate — operator still pre-adds trusted phone numbers
- Dynamic enrollment handles identity AFTER the number is trusted: who is this caller and how do they want to be known?
- Plugin checks `session.identityLinks` in `openclaw.json` on every inbound call to determine if the caller is enrolled
- Plugin registers a `link_identity` tool via `api.registerTool()` so the agent can write the enrollment result
- `link_identity` uses `api.runtime.config.writeConfigFile()` to persist the new entry to `openclaw.json`
- Enrolled callers get cross-channel session merging: `morpheus:main:sip-voice:direct:hue` same as `morpheus:main:discord:direct:987654321`

**Acceptance Criteria:**

**Given** an inbound call arrives from a phone number not present in `session.identityLinks`
**When** the plugin processes the initial query
**Then** the plugin passes `{ isFirstCall: true }` alongside the query so the agent knows to run enrollment

**Given** the agent detects `isFirstCall: true` in its context
**When** generating the opening of the conversation
**Then** the agent introduces itself and asks the caller their name and which channels they use (Discord, Telegram, web UI, etc.)

**Given** the caller provides their name and channel information during enrollment
**When** the agent calls the `link_identity({ name, channels })` tool
**Then** the plugin loads `openclaw.json`, adds `session.identityLinks[name] = ["sip-voice:<phoneNumber>", ...channels]`, and writes the config back via `api.runtime.config.writeConfigFile()`

**Given** `link_identity` is called while another enrollment is in progress (race condition)
**When** the config is written
**Then** the write is serialized — no concurrent writes corrupt the config (mutex or sequential queue)

**Given** a caller's phone number IS present in `session.identityLinks`
**When** the plugin processes the initial query
**Then** the plugin passes `{ isFirstCall: false, identity: "<canonicalName>" }` so the agent addresses the caller by name

**Given** the `link_identity` tool call fails (config write error)
**When** the error occurs
**Then** the plugin logs at ERROR level and returns an error to the agent; the call continues normally without enrollment persisted

### Story 5.3: Dynamic Greeting & Call Continuity — FR34, FR35

As a caller,
I want the agent to greet me personally and pick up our last conversation,
So that every call feels like a continuation of an ongoing relationship rather than starting from scratch.

**Design notes:**
- The hardcoded greeting `"Hello! I'm your server. How can I help you today?"` in `conversation-loop.js` is replaced with an initial bridge query
- Hold music plays during the initial query (same `loopHoldMusic()` pattern from Story 4.3) — 2–4 seconds, no dead air
- The initial query passes caller identity context so the agent can personalize the greeting
- OpenClaw's session persistence handles the "last conversation" memory — the agent already has history; the initial query just gives it permission to use it
- `skipGreeting` flag is reused: `skipGreeting: false` (inbound) triggers the initial query; `skipGreeting: true` (outbound conversation mode) remains unchanged

**Acceptance Criteria:**

**Given** an inbound call arrives and the call is answered
**When** `runConversationLoop()` starts with `skipGreeting: false`
**Then** hold music starts immediately and an initial bridge query is sent with caller identity context (`{ isFirstCall, identity, peerId }`)

**Given** the initial bridge query is sent
**When** the agent responds with a greeting
**Then** hold music stops and the TTS-rendered greeting plays to the caller — the agent's voice, the agent's words

**Given** the caller is known (present in `identityLinks`) and has prior conversation history
**When** the agent generates the greeting
**Then** the agent addresses the caller by their canonical name and references relevant context from the last conversation if appropriate

**Given** the caller is unknown (not in `identityLinks`)
**When** the agent generates the greeting
**Then** the agent introduces itself and begins enrollment (connects to Story 5.2 flow)

**Given** the initial bridge query fails (connection error, 503)
**When** the error is detected
**Then** the voice-app falls back to a configurable static greeting (new env var: `FALLBACK_GREETING`) and continues the call normally — no call dropped

**Given** outbound calls with `skipGreeting: true`
**When** `runConversationLoop()` starts
**Then** behavior is unchanged — no initial query, `initialContext` prime used instead (brownfield preserved)

### Story 5.4: Agent Tools & SKILL.md — FR32, FR36

As an OpenClaw agent (Morpheus, Cephanie),
I want `place_call` and `link_identity` tools registered by the plugin and a `SKILL.md` loaded into my context,
So that I know when and how to initiate outbound calls and enroll new callers autonomously.

**Design notes:**
- Plugin registers `api.registerTool('place_call', ...)` — gives agents outbound call capability
- Plugin registers `api.registerTool('link_identity', ...)` — gives agents enrollment capability
- `SKILL.md` loaded via `"skills": ["./skills"]` in `openclaw.plugin.json` — gives agents the instructions
- `SKILL.md` covers three behaviors: outbound calling (both modes), identity enrollment, and call continuity

**Acceptance Criteria:**

**Given** the plugin is loaded by the OpenClaw gateway
**When** an agent's context is initialized
**Then** both `place_call` and `link_identity` tools are available and `SKILL.md` is loaded

**Given** the agent calls `place_call` with `{ to, device, message, mode }`
**When** the tool executes
**Then** it POSTs to `POST /api/outbound-call` on the voice-app and returns `{ callId, status }` to the agent

**Given** the agent calls `link_identity` with `{ name, channels }`
**When** the tool executes
**Then** the plugin writes `session.identityLinks[name]` to `openclaw.json` and returns `{ ok: true, identity: name }`

**Given** the voice-app is unreachable when `place_call` is invoked
**When** the HTTP request fails
**Then** the tool returns an error and the agent falls back to delivering the update via the primary channel only

**Given** a user says "call me when this task is done"
**When** the task completes
**Then** the agent posts the full result to the primary channel first, then calls with a brief summary

**Given** `SKILL.md` is loaded into the agent's context
**When** the agent encounters an unenrolled first-time caller
**Then** the agent follows the enrollment instructions: ask for name, ask for channels, call `link_identity`

### Story 5.5: Persistent Per-Identity Session Context

As a returning caller (e.g. Hue calling in via SIP),
I want the agent to remember our previous conversations,
So that context carries over across calls without me having to repeat myself.

**Design notes:**
- Currently `sessionFile` is keyed by `callId` (UUID) — brand new file every call, no memory
- Fix: key by `identityContext.identity` (enrolled name) or normalized `peerId` (phone digits only, no `+`) for unenrolled but returning callers; fall back to `callId` if neither is available
- Each agent maintains its own history per caller: `morpheus-hue.jsonl`, `cephanie-hue.jsonl`
- `runEmbeddedPiAgent` already reads the sessionFile on start and appends each turn — no API change needed
- `sessionKey` must also change to match (used for in-process deduplication)

**Acceptance Criteria:**

**Given** a caller with enrolled identity "hue" calls in
**When** `queryAgent` resolves the session file path
**Then** `sessionFile` is `sip-voice/morpheus-hue.jsonl` (keyed by identity name, not callId) and the agent has full context from prior calls

**Given** an unenrolled but returning caller with `peerId = "+15551234567"` calls in
**When** `queryAgent` resolves the session file path
**Then** `sessionFile` is `sip-voice/morpheus-15551234567.jsonl` (normalized phone, no `+`) so context accumulates even before enrollment

**Given** no `peerId` is available (extension-only call, no CLI number)
**When** `queryAgent` resolves the session file path
**Then** `sessionFile` falls back to `sip-voice/morpheus-<callId>.jsonl` (ephemeral, current behaviour)

**Given** a caller enrolls mid-call (first-time caller who completes enrollment)
**When** subsequent calls arrive from the same number
**Then** the session file transitions to identity-keyed on the next call (no migration of the phone-keyed file required)

### Story 5.6: Identity Resolution for Outbound Callbacks — FR20, FR30

As an operator,
I want agents to resolve a caller's identity to a callback phone number automatically,
So that an agent can call someone back using only their canonical name — no phone number needed.

**Acceptance Criteria:**

**Given** the plugin config contains `identityLinks: { "operator": ["sip-voice:+15551234567"] }` (plugin-scoped, for outbound resolution)
**When** the plugin starts
**Then** the identity links are loaded and available for callback lookup, and the plugin logs `[sip-voice] loaded 1 identity link(s)`

**Given** an OpenClaw agent needs to call back user "operator"
**When** the plugin resolves the identity "operator" via identityLinks
**Then** the plugin extracts the phone number `+15551234567` from the `sip-voice:` prefixed entry

**Given** an identity has no `sip-voice:` entry
**When** the plugin attempts to resolve a callback number
**Then** the resolution returns `null` and the agent is informed that no SIP callback number is configured for that identity

**Given** the `peerId` passed during an inbound call was dynamically enrolled via Story 5.2
**When** the agent later needs to call back the same caller
**Then** the agent can resolve their callback number from `session.identityLinks` without the caller needing to provide it verbally

_Note: depends on Story 5.5 for full context — agent will have prior conversation history when placing the callback._

### Story 5.7: Cross-Channel Response Delivery — FR33

As an OpenClaw agent,
I want to detect when my response is too long or complex for voice,
So that I deliver a brief voice summary and route the full response to the user's primary channel.

**Design notes:**
- Voice is intentionally low-bandwidth — 1-2 sentences max for spoken delivery
- Primary channel = wherever the user is active (Discord, Telegram, Slack)
- This is intelligent medium selection, not a fallback — the agent chooses the right channel for the content

**Acceptance Criteria:**

**Given** the agent's response exceeds ~40 words or contains structured data (lists, diffs, metrics, code)
**When** the agent prepares the voice reply
**Then** the agent speaks a brief summary (e.g. "Deployment finished. Full report in Discord.") and sends the complete response to the user's configured primary channel

**Given** the agent's response is concise and conversational
**When** the agent prepares the voice reply
**Then** the full response is spoken — no cross-channel delivery needed

**Given** no primary channel is configured for the user
**When** a long response would normally be routed to the primary channel
**Then** the agent speaks a truncated version and informs the user no text channel is configured

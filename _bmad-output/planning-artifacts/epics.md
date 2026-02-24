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
FR6: The system can reject calls from unknown callers with a configurable audio message, without invoking an agent
FR7: An operator can configure `dmPolicy` per extension (`allowlist`, `pairing`, `open`) to control caller access rules
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
NFR-S6: `dmPolicy: allowlist` is the mandatory default for any extension exposed to a DID/PSTN number

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

### Additional Requirements

- **Brownfield foundation**: No starter template — existing drachtio + FreeSWITCH + FreePBX codebase is the base; voice-app changes are minimal (one new file: `openclaw-bridge.js`)
- **Bridge loader**: `BRIDGE_TYPE` env var selects bridge at runtime (`const bridge = require('./lib/${bridgeType}-bridge')`) — one env var, one require() line, no new files in voice-app beyond the bridge itself
- **Plugin API contract**: OpenClaw plugin API is `api.registerChannel()` + `api.registerGatewayMethod()` (NOT `gateway.start()` / `gateway.on()` as PRD assumed) — architecture-confirmed correction
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
| FR6 | Epic 3 | Reject unknown callers with audio message |
| FR7 | Epic 3 | Configure dmPolicy per extension |
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

## Epic List

### Epic 1: Inbound Call to OpenClaw Agent
An operator can install the plugin, configure the bridge, call an extension, and talk to their OpenClaw agent — hearing the agent's response spoken back.
**FRs covered:** FR1, FR8, FR9, FR14, FR15, FR21, FR22, FR23, FR27

### Epic 2: Multi-Agent Routing & Configuration
An operator can configure multiple extensions, each bound to a distinct agent, with structured config files. Speed-dial 9000 for Morpheus, 9002 for Cephanie — routing is deterministic.
**FRs covered:** FR2, FR3, FR4, FR26, FR28, FR29

### Epic 3: Caller Access Control
Only trusted callers reach agents. Unknown callers hear a rejection message and are disconnected. The operator controls access policy per extension.
**FRs covered:** FR5, FR6, FR7

### Epic 4: Call Quality & Session Lifecycle
Calls are smooth — hold music plays during agent processing (no dead air), hangups are clean, in-flight queries are aborted, sessions don't orphan, errors produce graceful audio messages, and logging is PII-safe.
**FRs covered:** FR10, FR11, FR12, FR13, FR16, FR17, FR24, FR25, FR31

### Epic 5: Outbound Calling & Identity Resolution
Agents can initiate calls to users (callbacks after task completion), operators can trigger outbound calls via API, and the system resolves user identities across channels for callback number lookup.
**FRs covered:** FR18, FR19, FR20, FR30

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

**Given** the plugin entry point (`src/index.js`) calls `api.registerChannel()` on initialization
**When** the OpenClaw gateway starts
**Then** the plugin registers the SIP voice channel and logs `[sip-voice] channel registered` at INFO level

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

**Given** the plugin config specifies `webhookPort: 3334` and `apiKey: "test-key"`
**When** the plugin starts
**Then** an Express HTTP server listens on port 3334 and logs `[sip-voice] webhook server listening on port 3334`

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

**Given** `BRIDGE_TYPE=openclaw`, `OPENCLAW_WEBHOOK_URL=http://host:3334`, and `OPENCLAW_API_KEY=test-key` are set in the environment
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

An operator can configure multiple extensions, each bound to a distinct agent, with structured config files. Speed-dial 9000 for Morpheus, 9002 for Cephanie — routing is deterministic.

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
So that calling 9000 always reaches Morpheus and 9002 always reaches Cephanie.

**Acceptance Criteria:**

**Given** the plugin config contains `accounts: [{ id: "morpheus", extension: "9000" }, { id: "cephanie", extension: "9002" }]` and `bindings: [{ accountId: "morpheus", agentId: "morpheus" }, { accountId: "cephanie", agentId: "cephanie" }]`
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

**Given** the multi-registrar (`multi-registrar.js`) registers extensions 9000 and 9002 with the PBX
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

Only trusted callers reach agents. Unknown callers hear a rejection message and are disconnected. The operator controls access policy per extension.

### Story 3.1: Caller Allowlist Validation

As an operator,
I want inbound calls validated against a per-extension `allowFrom` allowlist before any agent is invoked,
So that only trusted phone numbers can reach my agents.

**Acceptance Criteria:**

**Given** `devices.json` contains a device with `"extension": "9000"` and `"allowFrom": ["+15551234567", "+15559876543"]`
**When** an inbound call arrives on extension 9000 from caller ID `+15551234567`
**Then** the caller ID matches the `allowFrom` list and the call proceeds to the bridge for agent routing

**Given** an inbound call arrives on extension 9000 from caller ID `+15550000000` which is NOT in the `allowFrom` list
**When** the voice-app checks the caller ID
**Then** the call is rejected before the bridge `query()` method is ever called — the agent is never invoked

**Given** the `allowFrom` check occurs in the voice-app before any bridge interaction
**When** a call is rejected
**Then** no HTTP request is sent to the plugin webhook and no OpenClaw session is created

**Given** the caller's phone number is checked during validation
**When** the result is logged
**Then** the phone number appears only at DEBUG level, never at INFO/WARN/ERROR (NFR-S3)

### Story 3.2: Unknown Caller Rejection & DM Policy

As an operator,
I want unknown callers to hear a configurable rejection message and be disconnected, with configurable access policy per extension,
So that spammers and unauthorized callers never reach my agents.

**Acceptance Criteria:**

**Given** an inbound call from an unknown caller (not in `allowFrom`) arrives on a `dmPolicy: "allowlist"` extension
**When** the voice-app rejects the call
**Then** the caller hears a configurable audio rejection message before the call is disconnected

**Given** the `dmPolicy` field is not set for an extension that is exposed to a DID/PSTN number
**When** the voice-app loads the device configuration
**Then** `dmPolicy` defaults to `"allowlist"` (NFR-S6 — mandatory default for DID-exposed extensions)

**Given** `dmPolicy` is set to `"open"` for an extension
**When** any caller dials that extension
**Then** all callers are accepted regardless of `allowFrom` (suitable only for internal PBX extensions with no PSTN exposure)

**Given** `dmPolicy` is set to `"pairing"` for an extension
**When** an unknown caller dials that extension
**Then** the caller receives a pairing code and instructions to verify via another channel (Growth scope — stub implementation acceptable at MVP)

**Given** a call is rejected due to `dmPolicy` enforcement
**When** the rejection occurs
**Then** the agent is never invoked, no session is created, and the event is logged at INFO level as `[sip-voice] call rejected: unknown caller on extension <ext>` (without the phone number)

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

## Epic 5: Outbound Calling & Identity Resolution

Agents can initiate calls to users (callbacks after task completion), operators can trigger outbound calls via API, and the system resolves user identities across channels for callback number lookup.

### Story 5.1: Plugin-Triggered Outbound Calls

As an OpenClaw agent,
I want to trigger an outbound call from the plugin to the voice-app,
So that I can call users back after completing a task.

**Acceptance Criteria:**

**Given** the plugin needs to initiate an outbound call to a user
**When** the plugin sends `POST /api/outbound-call` to the voice-app with body `{ "to": "+15551234567", "accountId": "morpheus", "message": "Your task is complete." }`
**Then** the voice-app initiates a SIP call to the specified phone number using the agent's configured extension and voice

**Given** the outbound call is answered by the recipient
**When** the call connects
**Then** the voice-app synthesizes the `message` text via TTS using the agent's configured `voiceId` and plays it to the recipient

**Given** an operator wants to trigger an outbound call directly
**When** the operator sends `POST /api/outbound-call` to the voice-app REST API with the same body format
**Then** the call is initiated identically to a plugin-triggered call (FR19 — same endpoint, same behavior)

**Given** the plugin attempts to trigger an outbound call but the voice-app is unreachable
**When** the HTTP request fails
**Then** the plugin logs the error at ERROR level with `[sip-voice]` prefix and does not crash — the error is reported back to the OpenClaw agent

**Given** the outbound call is initiated with `accountId: "morpheus"`
**When** the voice-app looks up the device config
**Then** the call uses Morpheus's SIP credentials, extension, and voice settings from `devices.json`

### Story 5.2: Identity Resolution via identityLinks

As an operator,
I want to configure identity links mapping user identities to phone numbers,
So that agents can resolve a user's callback number from their identity across channels.

**Acceptance Criteria:**

**Given** the plugin config contains `identityLinks: { "hue": ["sip-voice:+15551234567"] }`
**When** the plugin starts
**Then** the identity links are loaded and available for lookup, and the plugin logs `[sip-voice] loaded 1 identity link(s)`

**Given** an OpenClaw agent needs to call back user "hue"
**When** the plugin resolves the identity "hue" via identityLinks
**Then** the plugin extracts the phone number `+15551234567` from the `sip-voice:` prefixed entry

**Given** an identity has multiple `sip-voice:` entries (e.g., `["sip-voice:+15551234567", "sip-voice:+15559876543"]`)
**When** the plugin resolves the identity
**Then** the first `sip-voice:` entry is used as the callback number

**Given** an identity has no `sip-voice:` entry (only Discord, Telegram, etc.)
**When** the plugin attempts to resolve a callback number
**Then** the resolution returns `null` and the agent is informed that no SIP callback number is configured for that identity

**Given** the `peerId` passed during an inbound call matches an `identityLinks` entry
**When** the agent later needs to call back the same user
**Then** the agent can resolve the user's identity to the callback number without the caller needing to provide their number verbally

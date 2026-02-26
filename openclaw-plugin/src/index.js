'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

const logger = require('./logger');
const sessionStore = require('./session-store');
const { createServer, startServer } = require('./webhook-server');
const outboundClient = require('./outbound-client');
const { resolveIdentity, createLinkIdentityHandler } = require('./identity');

// ---------------------------------------------------------------------------
// extensionAPI loader
//
// OpenClaw exposes runEmbeddedPiAgent and agent-path helpers via
// dist/extensionAPI.js (ESM). It is NOT part of the plugin SDK (api.runtime
// has no agent invocation method). We locate the file by searching standard
// node_modules paths then falling back to `npm root -g`.
//
// See docs/openclaw-plugin-architecture.md for full background.
// ---------------------------------------------------------------------------

function findExtensionAPIPath() {
  const candidates = (require.resolve.paths('openclaw') || []).map(
    p => path.join(p, 'openclaw', 'dist', 'extensionAPI.js')
  );

  try {
    const npmGlobal = execSync('npm root -g', { encoding: 'utf8', stdio: 'pipe' }).trim();
    candidates.push(path.join(npmGlobal, 'openclaw', 'dist', 'extensionAPI.js'));
  } catch { /* ignore */ }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    '[sip-voice] Cannot locate openclaw dist/extensionAPI.js — ' +
    'ensure openclaw is installed globally and accessible from this process'
  );
}

let _extAPI = null;

async function getExtensionAPI() {
  if (_extAPI) return _extAPI;
  const apiPath = findExtensionAPIPath();
  _extAPI = await import(pathToFileURL(apiPath).href);
  return _extAPI;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Determines the session suffix for file naming and session key.
 * Priority: enrolled identity name > normalized phone > callId (ephemeral).
 */
function resolveSessionSuffix(identityContext, peerId, callId) {
  if (identityContext && identityContext.identity) {
    return identityContext.identity;
  }
  if (peerId) {
    return peerId.replace(/^\+/, '');
  }
  return callId;
}

let _server = null;

const plugin = {
  id: 'openclaw-sip-voice',
  name: 'SIP Voice',
  description: 'SIP telephone channel for OpenClaw agents via FreePBX',

  /**
   * Called synchronously by the OpenClaw plugin loader.
   * Heavy async work (webhook server start, extensionAPI import) is deferred
   * to api.registerService() which runs async start/stop lifecycle.
   *
   * @param {import('openclaw/plugin-sdk').OpenClawPluginApi} api
   */
  register(api) {
    const config = api.pluginConfig || {};
    const accounts = config.accounts || [];
    const bindings = config.bindings || [];
    const voiceAppUrl = config.voiceAppUrl || null;
    if (!voiceAppUrl) {
      logger.warn('voiceAppUrl not configured — outbound calls will fail until set in plugin config');
    }

    // Register link_identity agent tool — allows agents to enroll new callers
    // by linking their phone number to a canonical identity in openclaw.json.
    api.registerTool({
      name: 'link_identity',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Canonical name for the caller (e.g., "hue")' },
          channels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional channel identifiers (e.g., ["discord:987654321"])',
          },
          peerId: { type: 'string', description: 'Phone number being enrolled' },
        },
        required: ['name', 'peerId'],
      },
      handler: createLinkIdentityHandler(api),
    });

    // Register place_call agent tool — allows agents to initiate outbound calls
    // via the voice-app REST API.
    api.registerTool({
      name: 'place_call',
      schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destination phone number (E.164) or extension' },
          device: { type: 'string', description: 'Extension/device name to call from (e.g., "9000")' },
          message: { type: 'string', maxLength: 1000, description: 'TTS message to play when call is answered (max 1000 chars)' },
          mode: {
            type: 'string',
            enum: ['announce', 'conversation'],
            description: 'Call mode: "announce" (one-way, default) or "conversation" (two-way)',
          },
        },
        required: ['to', 'device', 'message'],
      },
      handler: async ({ to, device, message, mode }) => {
        logger.info('place_call tool invoked', { device });
        logger.debug('place_call destination', { to });
        const result = await outboundClient.placeCall({ voiceAppUrl, to, device, message, mode });
        if (result.error) {
          logger.warn('place_call failed', { error: result.error });
        } else {
          logger.info('place_call succeeded', { callId: result.callId });
        }
        return result;
      },
    });

    // Reap stale sessions from prior gateway runs (OpenClaw bug #3290).
    sessionStore.clear();

    // ------------------------------------------------------------------
    // queryAgent — routes a voice prompt to a named OpenClaw agent.
    //
    // Uses runEmbeddedPiAgent from extensionAPI.js to run the agent
    // in-process. Session is keyed by caller identity (enrolled name
    // or phone number) so context persists across calls.
    // ------------------------------------------------------------------
    const queryAgent = async (agentId, sessionId, prompt, peerId, identityContext) => {
      const ext = await getExtensionAPI();
      const ocConfig = api.config;

      // Prepend caller context so the agent knows whether to run enrollment flow.
      // For first-time callers, include the phone number so the agent can pass it
      // to link_identity — without it, enrollment is impossible.
      let enrichedPrompt = prompt;
      if (identityContext) {
        const ctxLine = identityContext.isFirstCall
          ? `[CALLER CONTEXT: First-time caller, no identity on file${peerId ? `, phone="${peerId}"` : ''}]`
          : `[CALLER CONTEXT: Known caller, identity="${identityContext.identity}"]`;
        enrichedPrompt = ctxLine + '\n' + prompt;
      }

      const suffix = resolveSessionSuffix(identityContext, peerId, sessionId);
      const sessionKey = `sip-voice:${agentId}:${suffix}`;
      const storePath = path.dirname(ext.resolveStorePath(ocConfig?.session?.store));
      const agentDir = ext.resolveAgentDir(ocConfig, agentId);
      const workspaceDir = ext.resolveAgentWorkspaceDir(ocConfig, agentId);
      const sessionFile = path.join(storePath, 'sip-voice', `${agentId}-${suffix}.jsonl`);

      // Ensure workspace dir exists before running agent.
      await ext.ensureAgentWorkspace({ dir: workspaceDir });

      const result = await ext.runEmbeddedPiAgent({
        sessionId: suffix,
        sessionKey,
        messageProvider: 'sip-voice',
        sessionFile,
        workspaceDir,
        config: ocConfig,
        prompt: enrichedPrompt,
        timeoutMs: config.agentTimeoutMs || 30000,
        runId: `sip:${sessionId}:${Date.now()}`,
        lane: 'voice',
        agentDir,
      });

      // Concatenate non-error text payloads into a single response string.
      const text = (result.payloads || [])
        .filter(p => p.text && !p.isError)
        .map(p => p.text.trim())
        .join(' ')
        .trim();

      return text || null;
    };

    // ------------------------------------------------------------------
    // Background service — Express webhook server lifecycle.
    // Receives POST /voice/query from voice-app, calls queryAgent,
    // returns agent response.
    // ------------------------------------------------------------------
    api.registerService({
      id: 'sip-voice-webhook',

      start: async () => {
        logger.info(`loaded ${bindings.length} account bindings`, {
          accounts: accounts.length,
          bindings: bindings.length,
        });
        const app = createServer({
          apiKey: config.apiKey,
          bindings,
          accounts,
          queryAgent,
          resolveIdentity: (peerId) => resolveIdentity(api.config, peerId),
        });
        const port = config.webhookPort || 47334;
        _server = await startServer(app, port);
      },

      stop: async () => {
        if (_server) {
          await new Promise((resolve) => _server.close(resolve));
          _server = null;
        }
      },
    });
  },
};

// Expose resolveSessionSuffix for test access (prefixed with _ to signal internal).
plugin._resolveSessionSuffix = resolveSessionSuffix;

module.exports = plugin;

'use strict';

const logger = require('./logger');
const sessionStore = require('./session-store');
const { createServer, startServer } = require('./webhook-server');

let pluginConfig = {};
// eslint-disable-next-line no-unused-vars
let _server = null; // stored for future graceful shutdown

async function activate(api) {
  try {
    pluginConfig = api.getConfig() || {};

    api.registerChannel({
      id: 'sip-voice',
      name: 'SIP Voice',
      description: 'SIP telephone channel for OpenClaw agents'
    });

    const accounts = pluginConfig.accounts || [];
    const bindings = pluginConfig.bindings || [];
    logger.info('channel registered', {
      accounts: accounts.length,
      bindings: bindings.length
    });

    // Reap stale sessions from prior gateway runs (OpenClaw bug #3290).
    sessionStore.clear();

    // Build queryAgent callback that routes to the OpenClaw agent via api.
    const queryAgent = async (agentId, sessionId, prompt, peerId) => {
      return await api.queryAgent(agentId, {
        sessionId,
        message: prompt,
        identity: peerId || undefined
      });
    };

    // Start webhook server with bindings and query callback.
    const app = createServer({
      apiKey: pluginConfig.apiKey,
      bindings,
      queryAgent
    });
    const port = pluginConfig.webhookPort || 3334;
    _server = await startServer(app, port);
  } catch (err) {
    logger.error('channel registration failed', { message: err.message });
    throw err;
  }
}

function getConfig() {
  return { ...pluginConfig };
}

module.exports = { activate, getConfig };

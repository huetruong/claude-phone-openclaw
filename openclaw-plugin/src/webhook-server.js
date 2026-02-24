'use strict';

const express = require('express');
const logger = require('./logger');
const sessionStore = require('./session-store');
const { createAuthMiddleware } = require('./auth');

/**
 * Creates an Express app (without binding a port).
 * Enables tests to inject via supertest/http without opening a socket.
 *
 * @param {object} config
 * @param {string} config.apiKey - Bearer token for auth middleware
 * @param {Array}  config.bindings - accountId → agentId mapping array
 * @param {Function} config.queryAgent - async (agentId, sessionId, prompt, peerId) => string
 */
function createServer(config = {}) {
  const app = express();
  const auth = createAuthMiddleware(config.apiKey);

  // Build O(1) lookup Map from bindings array.
  const bindingMap = new Map();
  for (const b of (config.bindings || [])) {
    bindingMap.set(b.accountId, b.agentId);
  }

  const queryAgent = config.queryAgent;

  // Health endpoint is unauthenticated — no body parsing needed.
  app.get('/voice/health', (req, res) => {
    res.json({ ok: true });
  });

  // Auth runs first on all /voice/* routes, before body parsing.
  // This ensures unauthenticated requests are rejected before any body allocation.
  app.use('/voice', auth);
  app.use('/voice', express.json());

  // POST /voice/query — route caller prompt to OpenClaw agent
  app.post('/voice/query', async (req, res) => {
    try {
      const { prompt, callId, accountId, peerId } = req.body;

      // Validate required fields.
      for (const field of ['prompt', 'callId', 'accountId']) {
        if (!req.body[field]) {
          return res.status(400).json({ error: `missing required field: ${field}` });
        }
      }

      // Resolve accountId → agentId.
      const agentId = bindingMap.get(accountId);
      if (!agentId) {
        return res.status(404).json({ error: 'no agent binding for accountId' });
      }

      // PII discipline: peerId at DEBUG only.
      logger.debug('voice query received', { callId, accountId, peerId });
      logger.info('voice query received', { callId, accountId });

      // Session management: create or resume.
      let sessionId = sessionStore.get(callId);
      if (!sessionId) {
        sessionId = callId; // Use callId as sessionId for correlation.
        sessionStore.create(callId, sessionId);
      }

      // Route query to OpenClaw agent.
      const response = await queryAgent(agentId, sessionId, prompt, peerId);
      res.json({ response });
    } catch (err) {
      logger.error('query failed', { callId: req.body.callId, error: err.message });
      res.status(503).json({ error: 'agent unavailable' });
    }
  });

  // POST /voice/end-session — remove session mapping (voice-app cleanup only)
  app.post('/voice/end-session', async (req, res) => {
    try {
      const { callId } = req.body;

      if (!callId) {
        return res.status(400).json({ error: 'missing required field: callId' });
      }

      if (!sessionStore.get(callId)) {
        logger.warn('end-session for unknown callId', { callId });
      } else {
        sessionStore.remove(callId);
        logger.info('session ended', { callId });
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error('end-session failed', { callId: req.body.callId, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Catch-all: unknown routes return JSON 404 (consistent with API contract).
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  return app;
}

/**
 * Binds the Express app to the given port and returns the http.Server instance.
 * Rejects if the port is already in use or permission is denied.
 */
function startServer(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      logger.info(`webhook server listening on port ${actualPort}`);
      resolve(server);
    });
    server.on('error', (err) => {
      logger.error('webhook server failed to start', { message: err.message });
      reject(err);
    });
  });
}

module.exports = { createServer, startServer };

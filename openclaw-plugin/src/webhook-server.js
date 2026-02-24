'use strict';

const express = require('express');
const logger = require('./logger');
const { createAuthMiddleware } = require('./auth');

/**
 * Creates an Express app (without binding a port).
 * Enables tests to inject via supertest/http without opening a socket.
 */
function createServer(config = {}) {
  const app = express();
  const auth = createAuthMiddleware(config.apiKey);

  // Health endpoint is unauthenticated — no body parsing needed.
  app.get('/voice/health', (req, res) => {
    res.json({ ok: true });
  });

  // Auth runs first on all /voice/* routes, before body parsing.
  // This ensures unauthenticated requests are rejected before any body allocation.
  app.use('/voice', auth);
  app.use('/voice', express.json());

  // Stub routes — business logic implemented in Story 1.3.
  app.post('/voice/query', async (req, res) => {
    res.status(501).json({ error: 'not implemented' });
  });

  app.post('/voice/end-session', async (req, res) => {
    res.status(501).json({ error: 'not implemented' });
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

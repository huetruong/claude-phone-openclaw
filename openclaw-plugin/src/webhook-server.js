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

  app.use(express.json());

  // Health endpoint is unauthenticated — registered BEFORE the auth middleware so
  // the response is sent before auth is ever checked for this route.
  app.get('/voice/health', (req, res) => {
    res.json({ ok: true });
  });

  // All remaining /voice/* routes require a valid Bearer token.
  app.use('/voice', auth);

  // Stub routes — business logic implemented in Story 1.3.
  app.post('/voice/query', async (req, res) => {
    res.status(501).json({ error: 'not implemented' });
  });

  app.post('/voice/end-session', async (req, res) => {
    res.status(501).json({ error: 'not implemented' });
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

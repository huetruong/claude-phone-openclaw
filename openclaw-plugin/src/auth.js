'use strict';

const logger = require('./logger');

/**
 * Factory that returns an Express Bearer-token auth middleware.
 * apiKey comes from plugin config (api.getConfig()), not from process.env.
 */
function createAuthMiddleware(apiKey) {
  if (!apiKey) {
    throw new Error('[sip-voice] apiKey is required: webhook server cannot start without a configured API key');
  }
  return function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ') || header.slice(7) !== apiKey) {
      logger.warn('auth failed: missing or invalid token', { method: req.method, path: req.path });
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}

module.exports = { createAuthMiddleware };

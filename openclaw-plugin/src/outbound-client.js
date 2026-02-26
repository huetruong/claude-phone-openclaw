'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const logger = require('./logger');

const MAX_MESSAGE_LENGTH = 1000;

/**
 * Places an outbound call via the voice-app REST API.
 *
 * @param {object} params
 * @param {string} params.voiceAppUrl - Base URL of voice-app API (e.g. "http://host:3000/api")
 * @param {string} params.to          - Destination phone number (+ prefix will be stripped)
 * @param {string} params.device      - Extension number or device name (e.g. "9000")
 * @param {string} params.message     - TTS message to play when call is answered (max 1000 chars)
 * @param {string} [params.mode]      - "announce" (default) or "conversation"
 * @returns {Promise<{callId: string, status: string}|{error: string}>}
 */
async function placeCall({ voiceAppUrl, to, device, message, mode = 'announce' }) {
  // Input validation — catch missing/invalid params before making any network call.
  if (!to) {
    logger.error('outbound call failed: missing required field: to');
    return { error: 'missing required field: to' };
  }
  if (!device) {
    logger.error('outbound call failed: missing required field: device');
    return { error: 'missing required field: device' };
  }
  if (!message) {
    logger.error('outbound call failed: missing required field: message');
    return { error: 'missing required field: message' };
  }
  if (typeof message === 'string' && message.length > MAX_MESSAGE_LENGTH) {
    logger.error('outbound call failed: message exceeds maximum length', { max: MAX_MESSAGE_LENGTH });
    return { error: `message exceeds ${MAX_MESSAGE_LENGTH} character limit` };
  }

  // Strip leading + to avoid PSTN prefix logic in outbound-handler.js:58-59
  const normalizedTo = typeof to === 'string' ? to.replace(/^\+/, '') : to;

  const body = JSON.stringify({ to: normalizedTo, device, message, mode });
  const url = `${voiceAppUrl}/outbound-call`;

  return new Promise((resolve) => {
    // settled flag prevents double-logging and double-resolve when req.destroy()
    // triggers an error event after the timeout handler has already settled the promise.
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      logger.error('outbound call failed: invalid voiceAppUrl', { error: err.message });
      settle({ error: `invalid voiceAppUrl: ${err.message}` });
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          logger.error('outbound call failed: non-2xx response', {
            statusCode: res.statusCode,
          });
          settle({ error: `voice-app returned HTTP ${res.statusCode}` });
          return;
        }

        let data;
        try {
          data = JSON.parse(raw);
        } catch (parseErr) {
          logger.error('outbound call failed: invalid JSON response', { error: parseErr.message });
          settle({ error: 'invalid JSON response from voice-app' });
          return;
        }

        if (!data.callId) {
          logger.error('outbound call failed: missing callId in response');
          settle({ error: 'invalid response from voice-app: missing callId' });
          return;
        }

        settle({ callId: data.callId, status: data.status });
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH') {
        logger.error('voice-app unreachable', { error: err.code });
        settle({ error: 'voice-app unreachable' });
      } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') {
        logger.error('voice-app timeout', { error: err.code });
        settle({ error: 'voice-app timeout' });
      } else {
        logger.error('outbound call failed', { error: err.message });
        settle({ error: err.message });
      }
    });

    req.setTimeout(10000, () => {
      logger.error('voice-app timeout', { error: 'ETIMEDOUT' });
      req.destroy();
      settle({ error: 'voice-app timeout' });
    });

    req.write(body);
    req.end();
  });
}

module.exports = { placeCall };

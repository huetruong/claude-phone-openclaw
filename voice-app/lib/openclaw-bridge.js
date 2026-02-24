'use strict';

/**
 * OpenClaw HTTP Bridge
 * Drop-in replacement for claude-bridge.js — routes calls through the OpenClaw plugin.
 * Interface: query(prompt, options), endSession(callId), isAvailable()
 */

const axios = require('axios');

const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL || '';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

if (!OPENCLAW_WEBHOOK_URL) {
  console.warn('[OPENCLAW] OPENCLAW_WEBHOOK_URL is not set — bridge will not connect');
}
if (!OPENCLAW_API_KEY) {
  console.warn('[OPENCLAW] OPENCLAW_API_KEY is not set — requests will fail authentication');
}

/**
 * Query an OpenClaw agent via the SIP voice plugin.
 * @param {string} prompt - The transcript/question to send to the agent
 * @param {Object} options - Call options
 * @param {string} options.callId - Call UUID for session tracking
 * @param {string} [options.accountId] - Account/device ID (added by Story 2.1)
 * @param {string} [options.peerId] - Caller phone number (PII — logged at DEBUG only)
 * @param {number} [options.timeout=30] - Timeout in seconds
 * @returns {Promise<string>} Agent response string
 */
async function query(prompt, options = {}) {
  const { callId, accountId, peerId, timeout = 30 } = options;
  const timestamp = new Date().toISOString();

  try {
    console.log('[' + timestamp + '] OPENCLAW Sending query to ' + OPENCLAW_WEBHOOK_URL + '...');
    if (callId) {
      console.log('[' + timestamp + '] OPENCLAW Session: ' + callId);
    }
    if (accountId) {
      console.log('[' + timestamp + '] OPENCLAW Account: ' + accountId);
    }
    // peerId is PII — omit from INFO-level logs (DEBUG only per NFR-S3)

    // Build body; omit undefined optional fields (forward compat with Story 2.1)
    const body = { prompt, callId };
    if (accountId) body.accountId = accountId;
    if (peerId) body.peerId = peerId;

    const response = await axios.post(
      OPENCLAW_WEBHOOK_URL + '/voice/query',
      body,
      {
        timeout: timeout * 1000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + OPENCLAW_API_KEY
        }
      }
    );

    console.log('[' + timestamp + '] OPENCLAW Response received');
    return response.data.response;

  } catch (error) {
    // Plugin unreachable — return friendly message (matches claude-bridge.js pattern)
    if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH') {
      console.warn('[' + timestamp + '] OPENCLAW Plugin unreachable (' + error.code + ')');
      return "I'm having trouble connecting to my brain right now. Please try again later.";
    }

    // Timeout — return friendly message
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      console.error('[' + timestamp + '] OPENCLAW Timeout after ' + timeout + ' seconds');
      return "I'm sorry, that request took too long. Please try again.";
    }

    // Plugin reports agent unavailable
    if (error.response && error.response.status === 503) {
      console.warn('[' + timestamp + '] OPENCLAW Plugin unavailable (503)');
      return "The agent is currently unavailable. Please try again later.";
    }

    console.error('[' + timestamp + '] OPENCLAW Error:', error.message);
    return "I encountered an unexpected error. Please try again.";
  }
}

/**
 * End an OpenClaw agent session when a call ends.
 * Non-critical — logs a warning on failure, never throws.
 * @param {string} callId - The call UUID to end the session for
 */
async function endSession(callId) {
  if (!callId) return;

  const timestamp = new Date().toISOString();

  try {
    await axios.post(
      OPENCLAW_WEBHOOK_URL + '/voice/end-session',
      { callId },
      {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + OPENCLAW_API_KEY
        }
      }
    );
    console.log('[' + timestamp + '] OPENCLAW Session ended: ' + callId);
  } catch (error) {
    console.warn('[' + timestamp + '] OPENCLAW Failed to end session: ' + error.message);
  }
}

/**
 * Check if the OpenClaw plugin is reachable.
 * @returns {Promise<boolean>} true if plugin responds with HTTP 200
 */
async function isAvailable() {
  try {
    await axios.get(OPENCLAW_WEBHOOK_URL + '/voice/health', {
      timeout: 5000,
      headers: { 'Authorization': 'Bearer ' + OPENCLAW_API_KEY }
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { query, endSession, isAvailable };

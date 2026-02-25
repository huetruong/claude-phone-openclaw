/**
 * Claude HTTP API Bridge
 * HTTP client for Claude API server with session management
 */

const axios = require('axios');

const CLAUDE_API_URL = process.env.CLAUDE_API_URL || 'http://localhost:3333';

/**
 * Query Claude via HTTP API with session support
 * @param {string} prompt - The prompt/question to send to Claude
 * @param {Object} options - Options including callId for session management
 * @param {string} options.callId - Call UUID for maintaining conversation context
 * @param {string} options.devicePrompt - Device-specific personality prompt
 * @param {number} options.timeout - Timeout in seconds (default: 30, AC27)
 * @returns {Promise<{response: string, isError: boolean}>} Response object
 */
async function query(prompt, options = {}) {
  const { callId, devicePrompt, timeout = 30, signal } = options; // AC27: Default 30s timeout
  const timestamp = new Date().toISOString();

  try {
    console.log(`[${timestamp}] CLAUDE Sending query to ${CLAUDE_API_URL}...`);
    if (callId) {
      console.log(`[${timestamp}] CLAUDE Session: ${callId}`);
    }
    if (devicePrompt) {
      console.log(`[${timestamp}] CLAUDE Device prompt: ${devicePrompt.substring(0, 50)}...`);
    }

    const axiosConfig = {
      timeout: timeout * 1000,
      headers: { 'Content-Type': 'application/json' }
    };
    if (signal) axiosConfig.signal = signal;

    const response = await axios.post(
      `${CLAUDE_API_URL}/ask`,
      { prompt, callId, devicePrompt },
      axiosConfig
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Claude API returned failure');
    }

    console.log(`[${timestamp}] CLAUDE Response received (${response.data.duration_ms}ms)`);
    if (response.data.sessionId) {
      console.log(`[${timestamp}] CLAUDE Session ID: ${response.data.sessionId}`);
    }
    return { response: response.data.response, isError: false };

  } catch (error) {
    // Abort (caller hangup) — re-throw so conversation loop exits cleanly
    if (axios.isCancel(error)) {
      console.log(`[${timestamp}] CLAUDE query aborted (caller hangup)`, callId ? `(${callId})` : '');
      throw error;
    }

    // AC26: API server unreachable during call - don't crash, return error response
    if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH') {
      console.warn(`[${timestamp}] CLAUDE API server unreachable (${error.code})`);
      return { response: "I'm having trouble connecting to my brain right now. The API server may be offline or unreachable. Please try again later.", isError: true };
    }

    // AC27: Timeout with helpful error message
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      console.error(`[${timestamp}] CLAUDE Timeout after ${timeout} seconds`);
      return { response: "I'm sorry, that request took too long. This might mean the API server is slow or there's a network issue. Try asking something simpler, or check that claude-phone api-server is running.", isError: true };
    }

    // API server reports agent unavailable
    if (error.response && error.response.status === 503) {
      console.warn(`[${timestamp}] CLAUDE API server unavailable (503)`);
      return { response: "The agent is currently unavailable. Please try again later.", isError: true };
    }

    console.error(`[${timestamp}] CLAUDE Error:`, error.message);
    // AC26: Don't crash on unknown errors, return error response
    return { response: "I encountered an unexpected error. Please check that the API server is running claude-phone api-server and is on the same network.", isError: true };
  }
}

/**
 * End a Claude session when a call ends
 * @param {string} callId - The call UUID to end the session for
 */
async function endSession(callId) {
  if (!callId) return;
  
  const timestamp = new Date().toISOString();
  
  try {
    await axios.post(
      `${CLAUDE_API_URL}/end-session`,
      { callId },
      { 
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log(`[${timestamp}] CLAUDE Session ended: ${callId}`);
  } catch (error) {
    // Non-critical, just log
    console.warn(`[${timestamp}] CLAUDE Failed to end session: ${error.message}`);
  }
}

/**
 * Check if Claude API is available
 * @param {Object} [options={}]
 * @param {number} [options.timeout=5000] - Timeout in milliseconds
 * @returns {Promise<boolean>} True if API is reachable
 */
async function isAvailable(options = {}) {
  const { timeout = 5000 } = options;
  try {
    await axios.get(`${CLAUDE_API_URL}/health`, { timeout });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  query,
  endSession,
  isAvailable
};

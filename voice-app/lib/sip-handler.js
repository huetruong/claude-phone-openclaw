/**
 * SIP Call Handler
 * v13: Inbound path unified with runConversationLoop() (Story 4.1)
 */

const { runConversationLoop, checkAllowFrom } = require('./conversation-loop');
const logger = require('./logger');

/**
 * Extract caller ID (E.164) from SIP From header
 */
function extractCallerId(req) {
  var from = req.get("From") || "";
  var match = from.match(/sip:([+\d]+)@/);
  if (match) return match[1];
  var numMatch = from.match(/<sip:(\d+)@/);
  if (numMatch) return numMatch[1];
  return "unknown";
}

/**
 * Extract dialed extension from SIP To header
 */
function extractDialedExtension(req) {
  var to = req.get("To") || "";
  var match = to.match(/sip:(\d+)@/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Strip video tracks from SDP (FreeSWITCH doesn't support H.261 and rejects with 488)
 * Keeps only audio tracks to ensure codec negotiation succeeds
 */
function stripVideoFromSdp(sdp) {
  if (!sdp) return sdp;

  const lines = sdp.split('\r\n');
  const result = [];
  let inVideoSection = false;

  for (const line of lines) {
    // Check if we're entering a video media section
    if (line.startsWith('m=video')) {
      inVideoSection = true;
      continue; // Skip the m=video line
    }

    // Check if we're entering a new media section (audio, etc.)
    if (line.startsWith('m=') && !line.startsWith('m=video')) {
      inVideoSection = false;
    }

    // Skip all lines in the video section
    if (inVideoSection) {
      continue;
    }

    result.push(line);
  }

  return result.join('\r\n');
}

/**
 * Handle incoming SIP INVITE
 */
async function handleInvite(req, res, options) {
  const { srf, mediaServer, deviceRegistry } = options;

  const callerId = extractCallerId(req);
  const dialedExt = extractDialedExtension(req);

  // Look up device config using deviceRegistry.get() (works with name OR extension)
  let deviceConfig = null;
  if (deviceRegistry && dialedExt) {
    deviceConfig = deviceRegistry.get(dialedExt);
    if (deviceConfig) {
      logger.info('Device matched', { device: deviceConfig.name, extension: dialedExt });
    } else {
      logger.info('Unknown extension, using default', { extension: dialedExt });
      deviceConfig = deviceRegistry.getDefault();
    }
  }

  // PII discipline: callerId at DEBUG only (NFR-S3)
  logger.debug('Incoming call details', { peerId: callerId, extension: dialedExt || 'unknown' });
  logger.info('Incoming call', { extension: dialedExt || 'unknown' });

  // ── Caller allowlist check — answer then immediately hang up ──
  // Must answer (200 OK) before destroying so FreePBX does not route to voicemail.
  // Pre-answer rejection codes (4xx/6xx) trigger PBX voicemail fallback.
  if (!checkAllowFrom(deviceConfig, callerId)) {
    logger.info(`[sip-voice] call rejected: unknown caller on extension ${deviceConfig?.extension}`);
    logger.debug('Rejected caller details', { peerId: callerId });
    try {
      const audioOnlySdp = stripVideoFromSdp(req.body);
      const result = await mediaServer.connectCaller(req, res, { remoteSdp: audioOnlySdp });
      result.dialog.destroy();
    } catch (e) {
      logger.debug('Reject connectCaller failed, falling back to 603', { error: e.message });
      try { res.send(603); } catch (_) { /* ignore */ }
    }
    return;
  }

  // ── Pre-call availability check — reject BEFORE answering (SIP 480) ──
  // Check before connectCaller so we don't waste a FreeSWITCH endpoint when the bridge is down.
  const bridgeAvailable = await options.claudeBridge.isAvailable({ timeout: 2000 });
  if (!bridgeAvailable) {
    logger.warn('[sip-voice] bridge unavailable, rejecting call (SIP 480)');
    res.send(480);
    return;
  }

  try {
    // Strip video from SDP to avoid FreeSWITCH 488 error with unsupported video codecs
    const originalSdp = req.body;
    const audioOnlySdp = stripVideoFromSdp(originalSdp);
    if (originalSdp !== audioOnlySdp) {
      logger.debug('Stripped video track from SDP');
    }

    const result = await mediaServer.connectCaller(req, res, { remoteSdp: audioOnlySdp });
    const { endpoint, dialog } = result;
    const callUuid = endpoint.uuid;

    logger.info('Call connected', { callUuid });

    // Destroy endpoint when dialog is torn down (handles hangup case)
    dialog.on('destroy', function() {
      logger.info('Call ended', { callUuid });
      if (endpoint) endpoint.destroy().catch(function() {});
    });

    // Run unified conversation loop (handles callActive tracking, cleanup, endSession)
    await runConversationLoop(endpoint, dialog, callUuid, {
      audioForkServer: options.audioForkServer,
      whisperClient: options.whisperClient,
      claudeBridge: options.claudeBridge,
      ttsService: options.ttsService,
      wsPort: options.wsPort,
      deviceConfig: deviceConfig,
      peerId: callerId
    });

    // After conversation ends gracefully (e.g. goodbye), send BYE
    try { dialog.destroy(); } catch (e) {}

    return { endpoint: endpoint, dialog: dialog, callUuid: callUuid };

  } catch (error) {
    logger.error('Call error', { error: error.message });
    try { res.send(500); } catch (e) {}
    throw error;
  }
}

module.exports = {
  handleInvite: handleInvite,
  extractCallerId: extractCallerId,
  extractDialedExtension: extractDialedExtension
};

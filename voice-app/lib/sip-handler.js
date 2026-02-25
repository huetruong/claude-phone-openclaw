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
  const { mediaServer, deviceRegistry } = options;

  const callerId = extractCallerId(req);
  const dialedExt = extractDialedExtension(req);

  // Look up device config using deviceRegistry.get() (works with name OR extension)
  let deviceConfig = null;
  if (deviceRegistry && dialedExt) {
    deviceConfig = deviceRegistry.get(dialedExt);
    if (deviceConfig) {
      console.log('[' + new Date().toISOString() + '] CALL Device matched: ' + deviceConfig.name + ' (ext ' + dialedExt + ')');
    } else {
      console.log('[' + new Date().toISOString() + '] CALL Unknown extension ' + dialedExt + ', using default');
      deviceConfig = deviceRegistry.getDefault();
    }
  }

  console.log('[' + new Date().toISOString() + '] CALL Incoming from: ' + callerId + ' to ext: ' + (dialedExt || 'unknown'));

  // ── Caller allowlist check — reject BEFORE answering ──
  if (!checkAllowFrom(deviceConfig, callerId)) {
    logger.info(`[sip-voice] call rejected: unknown caller on extension ${deviceConfig?.extension}`);
    logger.debug('Rejected caller details', { peerId: callerId });
    res.send(603);
    return;
  }

  try {
    // Strip video from SDP to avoid FreeSWITCH 488 error with unsupported video codecs
    const originalSdp = req.body;
    const audioOnlySdp = stripVideoFromSdp(originalSdp);
    if (originalSdp !== audioOnlySdp) {
      console.log('[' + new Date().toISOString() + '] CALL Stripped video track from SDP');
    }

    const result = await mediaServer.connectCaller(req, res, { remoteSdp: audioOnlySdp });
    const { endpoint, dialog } = result;
    const callUuid = endpoint.uuid;

    console.log('[' + new Date().toISOString() + '] CALL Connected: ' + callUuid);

    // Destroy endpoint when dialog is torn down (handles hangup case)
    dialog.on('destroy', function() {
      console.log('[' + new Date().toISOString() + '] CALL Ended');
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

    return { endpoint: endpoint, dialog: dialog, callerId: callerId, callUuid: callUuid };

  } catch (error) {
    console.error('[' + new Date().toISOString() + '] CALL Error:', error.message);
    try { res.send(500); } catch (e) {}
    throw error;
  }
}

module.exports = {
  handleInvite: handleInvite,
  extractCallerId: extractCallerId,
  extractDialedExtension: extractDialedExtension
};

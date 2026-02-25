/**
 * Shared Conversation Loop
 * Extracted from sip-handler.js for use by both inbound and outbound calls
 *
 * Features:
 * - VAD-based speech detection
 * - DTMF # key to end speech early
 * - Whisper transcription
 * - Claude API integration
 * - TTS response generation
 * - Turn-taking audio cues (beeps)
 * - Hold music during processing
 */

const logger = require('./logger');

// Audio cue URLs
const READY_BEEP_URL = 'http://127.0.0.1:3000/static/ready-beep.wav';
const GOTIT_BEEP_URL = 'http://127.0.0.1:3000/static/gotit-beep.wav';
const HOLD_MUSIC_URL = 'http://127.0.0.1:3000/static/hold-music.mp3';

/**
 * Resolve the URL to play for the unavailability message.
 * Prefers UNAVAILABLE_AUDIO_URL (static file) over TTS generation.
 * @param {Object} ttsService - TTS service for speech generation
 * @param {string|null} voiceId - Voice ID for TTS
 * @returns {Promise<string>} URL to play
 */
async function getUnavailabilityUrl(ttsService, voiceId) {
  if (process.env.UNAVAILABLE_AUDIO_URL) {
    return process.env.UNAVAILABLE_AUDIO_URL;
  }
  const msg = process.env.UNAVAILABLE_MESSAGE ||
    'The agent is currently unavailable. Please try again later.';
  return ttsService.generateSpeech(msg, voiceId);
}

// Claude Code-style thinking phrases
const THINKING_PHRASES = [
  "Pondering...",
  "Elucidating...",
  "Cogitating...",
  "Ruminating...",
  "Contemplating...",
  "Consulting the oracle...",
  "Summoning knowledge...",
  "Engaging neural pathways...",
  "Accessing the mainframe...",
  "Querying the void...",
  "Let me think about that...",
  "Processing...",
  "Hmm, interesting question...",
  "One moment...",
  "Searching my brain...",
];

function getRandomThinkingPhrase() {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}

function isGoodbye(transcript) {
  const lower = transcript.toLowerCase().trim();
  const goodbyePhrases = ['goodbye', 'good bye', 'bye', 'hang up', 'end call', "that's all", 'thats all'];
  return goodbyePhrases.some(phrase => {
    return lower === phrase || lower.includes(` ${phrase}`) ||
           lower.startsWith(`${phrase} `) || lower.endsWith(` ${phrase}`);
  });
}

/**
 * Extract voice-friendly line from Claude's response
 * Priority: VOICE_RESPONSE > CUSTOM COMPLETED > COMPLETED > first sentence
 */
function extractVoiceLine(response) {
  /**
   * Clean markdown and formatting from text for speech
   */
  function cleanForSpeech(text) {
    return text
      .replace(/\*+/g, '')              // Remove bold/italic markers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Convert [text](url) to just text
      .replace(/\[([^\]]+)\]/g, '$1')   // Remove remaining brackets
      .trim();
  }

  // Priority 1: Check for new VOICE_RESPONSE line (voice-optimized content)
  const voiceMatch = response.match(/🗣️\s*VOICE_RESPONSE:\s*([^\n]+)/im);
  if (voiceMatch) {
    const text = cleanForSpeech(voiceMatch[1]);
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    // Accept if under 60 words
    if (text && wordCount <= 60) {
      return text;
    }

    // If too long, log warning but continue to next fallback
    logger.warn('VOICE_RESPONSE too long, falling back', { wordCount, maxWords: 60 });
  }

  // Priority 2: Check for legacy CUSTOM COMPLETED line
  const customMatch = response.match(/🗣️\s*CUSTOM\s+COMPLETED:\s*(.+?)(?:\n|$)/im);
  if (customMatch) {
    const text = cleanForSpeech(customMatch[1]);
    if (text && text.split(/\s+/).length <= 50) {
      return text;
    }
  }

  // Priority 3: Check for standard COMPLETED line
  const completedMatch = response.match(/🎯\s*COMPLETED:\s*(.+?)(?:\n|$)/im);
  if (completedMatch) {
    return cleanForSpeech(completedMatch[1]);
  }

  // Priority 4: Fallback to first sentence
  const firstSentence = response.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length < 500) {
    return firstSentence.trim();
  }

  // Last resort: truncate
  return response.substring(0, 500).trim();
}

/**
 * Check if caller is allowed by device's allowFrom list.
 * Returns true if:
 * - deviceConfig is null/undefined (no device = no restriction)
 * - allowFrom is not set or empty (no restriction configured)
 * - peerId is in the allowFrom array
 *
 * @param {Object|null} deviceConfig - Device configuration
 * @param {string|null} peerId - Caller phone number (E.164 format)
 * @returns {boolean}
 */
function checkAllowFrom(deviceConfig, peerId) {
  if (!deviceConfig) return true;
  const allowFrom = deviceConfig.allowFrom;
  if (!Array.isArray(allowFrom) || allowFrom.length === 0) return true;
  return allowFrom.includes(peerId);
}

/**
 * Run the conversation loop
 *
 * @param {Object} endpoint - FreeSWITCH endpoint
 * @param {Object} dialog - SIP dialog
 * @param {string} callUuid - Unique call identifier
 * @param {Object} options - Configuration options
 * @param {Object} options.audioForkServer - WebSocket audio fork server
 * @param {Object} options.whisperClient - Whisper transcription client
 * @param {Object} options.claudeBridge - Claude API bridge
 * @param {Object} options.ttsService - TTS service
 * @param {number} options.wsPort - WebSocket port
 * @param {string} [options.initialContext] - Context for outbound calls (why we're calling)
 * @param {boolean} [options.skipGreeting=false] - Skip greeting (for outbound, greeting already played)
 * @param {number} [options.maxTurns=20] - Maximum conversation turns
 * @returns {Promise<void>}
 */
async function runConversationLoop(endpoint, dialog, callUuid, options) {
  const {
    audioForkServer,
    whisperClient,
    claudeBridge,
    ttsService,
    wsPort,
    initialContext = null,
    skipGreeting = false,
    deviceConfig = null,
    maxTurns = 20,
    peerId = null
  } = options;

  // Extract devicePrompt and voiceId from deviceConfig (for Cephanie etc)
  const devicePrompt = deviceConfig?.prompt || null;
  const voiceId = deviceConfig?.voiceId || null;  // null = use default Morpheus voice
  let session = null;
  let forkRunning = false;
  let callActive = true;
  let dtmfHandler = null;
  let abortController = null;

  // Track when call ends to prevent operations on dead endpoints
  const onDialogDestroy = () => {
    callActive = false;
    if (abortController) {
      abortController.abort();
    }
    logger.info('Call ended (dialog destroyed)', { callUuid });
  };

  try {
    logger.info('Conversation loop starting', {
      callUuid,
      skipGreeting,
      hasInitialContext: !!initialContext
    });

    // Listen for call end
    dialog.on('destroy', onDialogDestroy);

    // Play greeting (skip for outbound where initial message already played)
    if (!skipGreeting && callActive) {
      const greetingUrl = await ttsService.generateSpeech(
        "Hello! I'm your server. How can I help you today?",
        voiceId
      );
      await endpoint.play(greetingUrl);
    }

    // Prime Claude with context if this is an outbound call (NON-BLOCKING)
    // Fire-and-forget: we don't use the response, just establishing session context
    if (initialContext && callActive) {
      logger.info('Priming Claude with outbound context (non-blocking)', { callUuid });
      const primeController = new AbortController();
      const onPrimeDestroy = () => primeController.abort();
      dialog.on('destroy', onPrimeDestroy);
      claudeBridge.query(
        `[SYSTEM CONTEXT - DO NOT REPEAT]: You just called the user to tell them: "${initialContext}". They have answered. Now listen to their response and help them.`,
        { callId: callUuid, devicePrompt: devicePrompt, accountId: deviceConfig?.accountId, peerId, isSystemPrime: true, signal: primeController.signal }
      ).catch(err => {
        if (err.code !== 'ERR_CANCELED' && err.name !== 'CanceledError') {
          logger.warn('Prime query failed', { callUuid, error: err.message });
        }
      }).finally(() => dialog.off('destroy', onPrimeDestroy));
    }

    // Check if call is still active before starting audio fork
    if (!callActive) {
      logger.info('Call ended before audio fork could start', { callUuid });
      return;
    }

    // Start audio fork for entire call
    const wsUrl = `ws://127.0.0.1:${wsPort}/${encodeURIComponent(callUuid)}`;

    // Use try-catch for expectSession to handle race conditions
    let sessionPromise;
    try {
      sessionPromise = audioForkServer.expectSession(callUuid, { timeoutMs: 10000 });
    } catch (err) {
      logger.warn('Failed to set up session expectation', { callUuid, error: err.message });
      return;
    }

    await endpoint.forkAudioStart({
      wsUrl,
      mixType: 'mono',
      sampling: '16k'
    });
    forkRunning = true;

    try {
      session = await sessionPromise;
      logger.info('Audio fork connected', { callUuid });
    } catch (err) {
      logger.warn('Audio fork session failed', { callUuid, error: err.message });
      // Cancel the pending expectation if still there
      audioForkServer.cancelExpectation && audioForkServer.cancelExpectation(callUuid);
      return;
    }

    // Set up DTMF handler for # key
    dtmfHandler = (evt) => {
      const digit = evt.dtmf || evt.digit;
      logger.info('DTMF received', { callUuid, digit });

      if (digit === '#' && session) {
        logger.info('DTMF # pressed - forcing utterance finalization', { callUuid });
        session.forceFinalize();
      }
    };

    // Enable DTMF detection on endpoint
    try {
      // Tell FreeSWITCH to detect DTMF
      await endpoint.api('uuid_recv_dtmf', `${endpoint.uuid} true`);
      endpoint.on('dtmf', dtmfHandler);
      logger.info('DTMF detection enabled', { callUuid });
    } catch (err) {
      logger.warn('Failed to enable DTMF detection', { callUuid, error: err.message });
      // Continue without DTMF - not critical
    }

    // Emit session event for external monitoring
    if (audioForkServer.emit) {
      audioForkServer.emit('session', session);
    }
    logger.debug('Audio fork session active', { callUuid });

    // Main conversation loop
    let turnCount = 0;

    while (turnCount < maxTurns && callActive) {
      turnCount++;
      logger.info('Conversation turn', { callUuid, turn: turnCount, maxTurns });

      // ============================================
      // READY BEEP: Signal "your turn to speak"
      // ============================================
      try {
        if (callActive) await endpoint.play(READY_BEEP_URL);
      } catch (e) {
        if (!callActive) break;
        logger.warn('Ready beep failed', { callUuid, error: e.message });
      }

      // Enable capture and wait for speech
      session.setCaptureEnabled(true);
      logger.info('Waiting for speech (press # to send immediately)', { callUuid });

      let utterance = null;
      try {
        utterance = await session.waitForUtterance({ timeoutMs: 30000 });
        logger.info('Got utterance', { callUuid, bytes: utterance.audio.length, reason: utterance.reason });
      } catch (err) {
        if (!callActive) break;
        logger.info('Utterance timeout', { callUuid, error: err.message });
      }

      session.setCaptureEnabled(false);

      // Check if call ended during speech detection
      if (!callActive) {
        logger.info('Call ended during speech detection', { callUuid });
        break;
      }

      // Handle no speech
      if (!utterance) {
        const promptUrl = await ttsService.generateSpeech(
          "I didn't hear anything. Are you still there?",
          voiceId
        );
        if (callActive) await endpoint.play(promptUrl);
        continue;
      }

      // ============================================
      // GOT-IT BEEP: Signal "I heard you, processing"
      // ============================================
      try {
        if (callActive) await endpoint.play(GOTIT_BEEP_URL);
      } catch (e) {
        if (!callActive) break;
        logger.warn('Got-it beep failed', { callUuid, error: e.message });
      }

      // Transcribe
      const transcript = await whisperClient.transcribe(utterance.audio, {
        format: 'pcm',
        sampleRate: 16000
      });

      logger.info('Transcribed', { callUuid, transcript });

      // Handle empty transcription
      if (!transcript || transcript.trim().length < 2) {
        const clarifyUrl = await ttsService.generateSpeech(
          "Sorry, I didn't catch that. Could you repeat?",
          voiceId
        );
        if (callActive) await endpoint.play(clarifyUrl);
        continue;
      }

      // Handle goodbye
      if (isGoodbye(transcript)) {
        const byeUrl = await ttsService.generateSpeech("Goodbye! Call again anytime.", voiceId);
        if (callActive) await endpoint.play(byeUrl);
        break;
      }

      // ============================================
      // THINKING FEEDBACK
      // ============================================

      // Check if call still active before thinking feedback
      if (!callActive) break;

      // 1. Play random thinking phrase
      const thinkingPhrase = getRandomThinkingPhrase();
      logger.info('Playing thinking phrase', { callUuid, phrase: thinkingPhrase });
      const thinkingUrl = await ttsService.generateSpeech(thinkingPhrase, voiceId);
      if (callActive) await endpoint.play(thinkingUrl);

      // Create AbortController BEFORE hold music to close the race window where
      // onDialogDestroy fires between the callActive check and AbortController creation
      abortController = new AbortController();
      if (!callActive) {
        abortController.abort();
      }

      // 2. Start hold music — looping so audio continues for full query duration.
      // setImmediate between loops yields to the event loop so timers/I/O can run.
      let musicPlaying = false;
      function loopHoldMusic() {
        if (!musicPlaying || !callActive) return;
        endpoint.play(HOLD_MUSIC_URL)
          .then(() => setImmediate(loopHoldMusic))
          .catch((e) => { logger.warn('Hold music error', { callUuid, error: e.message }); });
      }
      if (callActive) {
        musicPlaying = true;
        loopHoldMusic();
      }

      // 3. Query Claude
      logger.info('Querying Claude', { callUuid });
      let claudeResponse;
      try {
        claudeResponse = await claudeBridge.query(
          transcript,
          { callId: callUuid, devicePrompt: devicePrompt, accountId: deviceConfig?.accountId, peerId, signal: abortController.signal }
        );
      } catch (queryError) {
        if (queryError.code === 'ERR_CANCELED' || queryError.name === 'CanceledError') {
          logger.info('Query aborted (caller hangup)', { callUuid });
          // Stop hold music on abort path (set false BEFORE uuid_break to prevent loop restart)
          if (musicPlaying) {
            musicPlaying = false;
            endpoint.api('uuid_break', endpoint.uuid).catch(() => {});
          }
          break;
        }
        throw queryError;
      } finally {
        abortController = null;
      }

      // 4. Stop hold music (set false BEFORE uuid_break to prevent loop restart)
      if (musicPlaying && callActive) {
        musicPlaying = false;
        await endpoint.api('uuid_break', endpoint.uuid).catch(() => {});
      }

      // Check if call ended during Claude processing
      if (!callActive) {
        logger.info('Call ended during Claude processing', { callUuid });
        break;
      }

      logger.info('Claude responded', { callUuid });

      // 5. Handle bridge error response (connection error, 503, etc.)
      if (!claudeResponse || claudeResponse.isError) {
        logger.error('Bridge error response', { callUuid, error: claudeResponse.response });
        const unavailUrl = await getUnavailabilityUrl(ttsService, voiceId);
        if (callActive) await endpoint.play(unavailUrl).catch(() => {});
        break;
      }

      // 6. Extract and play voice line
      const voiceLine = extractVoiceLine(claudeResponse.response);
      logger.info('Voice line', { callUuid, voiceLine });

      const responseUrl = await ttsService.generateSpeech(voiceLine, voiceId);
      if (callActive) await endpoint.play(responseUrl);

      logger.info('Turn complete', { callUuid, turn: turnCount });
    }

    // Max turns reached
    if (turnCount >= maxTurns && callActive) {
      const maxUrl = await ttsService.generateSpeech(
        "We've been talking for a while. Goodbye!",
        voiceId
      );
      await endpoint.play(maxUrl);
    }

    logger.info('Conversation loop ended normally', { callUuid, turns: turnCount });

  } catch (error) {
    logger.error('Conversation loop error', {
      callUuid,
      error: error.message,
      stack: error.stack
    });

    try {
      if (session) session.setCaptureEnabled(false);
      if (callActive) {
        const errUrl = await ttsService.generateSpeech("Sorry, something went wrong.", voiceId);
        await endpoint.play(errUrl);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  } finally {
    logger.info('Conversation loop cleanup', { callUuid });

    // Defensively abort any in-flight query
    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    // Remove dialog listener
    dialog.off('destroy', onDialogDestroy);

    // Remove DTMF handler
    if (dtmfHandler) {
      endpoint.off('dtmf', dtmfHandler);
    }

    // Cancel any pending session expectations
    if (audioForkServer.cancelExpectation) {
      audioForkServer.cancelExpectation(callUuid);
    }

    // End Claude session
    try {
      await claudeBridge.endSession(callUuid);
    } catch (e) {
      // Ignore
    }

    // Stop audio fork
    if (forkRunning) {
      try {
        await endpoint.forkAudioStop();
      } catch (e) {
        // Ignore
      }
    }
  }
}

module.exports = {
  runConversationLoop,
  checkAllowFrom,
  extractVoiceLine,
  isGoodbye,
  getRandomThinkingPhrase,
  getUnavailabilityUrl,
  READY_BEEP_URL,
  GOTIT_BEEP_URL,
  HOLD_MUSIC_URL
};

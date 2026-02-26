'use strict';

/**
 * Tests for dynamic greeting & call continuity (Story 5.3)
 *
 * - Hold music plays during initial bridge query (not silence)
 * - Successful bridge response → TTS-rendered greeting plays to caller
 * - Bridge error (isError: true) → FALLBACK_GREETING plays
 * - Bridge query throws (connection error) → FALLBACK_GREETING plays
 * - Bridge returns empty response → FALLBACK_GREETING plays
 * - skipGreeting: true → no initial query sent
 * - Caller hangup during greeting query → AbortController fires, no TTS play
 * - FALLBACK_GREETING env var → custom value used when set
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build minimal mocks for runConversationLoop tests focused on the greeting phase.
 * maxTurns defaults to 0 to exit the conversation loop immediately after greeting,
 * keeping tests focused on the greeting block only.
 *
 * @param {Object} opts
 * @param {Function} [opts.greetingQuery] - bridge.query implementation for greeting phase
 * @param {boolean} [opts.skipGreeting=false]
 * @param {number} [opts.maxTurns=0]
 * @returns mocks object
 */
function buildMocks(opts = {}) {
  const { skipGreeting = false, maxTurns = 0 } = opts;

  const calls = {
    playUrls: [],
    apiCalls: [],
    queryCalls: [],
    ttsTexts: [],
  };

  let dialogDestroyHandlers = [];
  let capturedDialogRef = null;

  const mockDialog = {
    on: (event, handler) => {
      if (event === 'destroy') dialogDestroyHandlers.push(handler);
    },
    off: (event, handler) => {
      if (event === 'destroy') {
        dialogDestroyHandlers = dialogDestroyHandlers.filter(h => h !== handler);
      }
    },
    fireDestroy: () => {
      // Copy array since handlers may remove themselves during iteration
      [...dialogDestroyHandlers].forEach(h => h());
    }
  };

  capturedDialogRef = mockDialog;

  const mockSession = {
    setCaptureEnabled: () => {},
    waitForUtterance: () => new Promise(() => {}), // never resolves (maxTurns=0 exits before this)
    forceFinalize: () => {}
  };

  let queryCallCount = 0;
  const mockBridge = {
    query: opts.greetingQuery || (() => Promise.resolve({ response: 'Hi there!', isError: false })),
    endSession: () => Promise.resolve(),
    isAvailable: () => Promise.resolve(true)
  };

  const mockEndpoint = {
    play: (url) => { calls.playUrls.push(url); return Promise.resolve(); },
    forkAudioStart: () => Promise.resolve(),
    forkAudioStop: () => Promise.resolve(),
    api: (cmd, arg) => { calls.apiCalls.push({ cmd, arg }); return Promise.resolve(); },
    on: () => {},
    off: () => {},
    uuid: 'test-uuid'
  };

  const mockAudioForkServer = {
    expectSession: () => Promise.resolve(mockSession),
    cancelExpectation: () => {},
    emit: () => {}
  };

  const mockWhisperClient = {
    transcribe: () => Promise.resolve('hello')
  };

  const mockTtsService = {
    generateSpeech: (text, voiceId) => {
      calls.ttsTexts.push(text);
      return Promise.resolve('http://tts/' + encodeURIComponent(text.substring(0, 40)));
    }
  };

  const defaultOptions = {
    audioForkServer: mockAudioForkServer,
    whisperClient: mockWhisperClient,
    claudeBridge: mockBridge,
    ttsService: mockTtsService,
    wsPort: 8080,
    deviceConfig: null,
    peerId: null,
    maxTurns,
    skipGreeting
  };

  return {
    calls,
    mockDialog,
    mockEndpoint,
    mockBridge,
    mockTtsService,
    defaultOptions
  };
}

// ---------------------------------------------------------------------------
// Test 1: Successful dynamic greeting
// ---------------------------------------------------------------------------

describe('dynamic-greeting: successful bridge query plays agent greeting', () => {
  const { runConversationLoop, HOLD_MUSIC_URL } = require('../lib/conversation-loop');

  it('hold music starts before the bridge query resolves', async () => {
    let holdMusicStartedBeforeQuery = false;

    const mocks = buildMocks({
      greetingQuery: () => {
        holdMusicStartedBeforeQuery = mocks.calls.playUrls.includes(HOLD_MUSIC_URL);
        return Promise.resolve({ response: 'Hello Hue!', isError: false });
      }
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-holdmusic-uuid',
      mocks.defaultOptions
    );

    assert.strictEqual(holdMusicStartedBeforeQuery, true, 'hold music must start before query resolves');
  });

  it('TTS-renders the agent greeting response', async () => {
    const mocks = buildMocks({
      greetingQuery: () => Promise.resolve({ response: 'Hey Hue, welcome back!', isError: false })
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-tts-uuid',
      mocks.defaultOptions
    );

    assert.ok(
      mocks.calls.ttsTexts.includes('Hey Hue, welcome back!'),
      'agent greeting response must be TTS-rendered'
    );
  });

  it('uuid_break is called to stop hold music before greeting plays', async () => {
    const mocks = buildMocks({
      greetingQuery: () => Promise.resolve({ response: 'Hello!', isError: false })
    });

    const events = [];
    mocks.mockEndpoint.play = (url) => { events.push({ type: 'play', url }); mocks.calls.playUrls.push(url); return Promise.resolve(); };
    mocks.mockEndpoint.api = (cmd, arg) => { events.push({ type: 'api', cmd, arg }); mocks.calls.apiCalls.push({ cmd, arg }); return Promise.resolve(); };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-uuidbreak-uuid',
      mocks.defaultOptions
    );

    const breakIdx = events.findIndex(e => e.type === 'api' && e.cmd === 'uuid_break');
    const greetingTtsIdx = events.findIndex(e => e.type === 'play' && e.url && e.url.startsWith('http://tts/') && e.url.includes('Hello'));

    assert.ok(breakIdx !== -1, 'uuid_break must be called');
    assert.ok(greetingTtsIdx !== -1, 'greeting TTS must be played');
    assert.ok(breakIdx < greetingTtsIdx, 'uuid_break must occur before greeting TTS plays');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Fallback greeting on bridge error
// ---------------------------------------------------------------------------

describe('dynamic-greeting: bridge error triggers FALLBACK_GREETING', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  afterEach(() => {
    delete process.env.FALLBACK_GREETING;
  });

  it('uses fallback when bridge returns isError: true', async () => {
    const mocks = buildMocks({
      greetingQuery: () => Promise.resolve({ response: 'agent error text', isError: true })
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-fallback-iserror-uuid',
      mocks.defaultOptions
    );

    assert.ok(
      mocks.calls.ttsTexts.some(t => t === 'Hello! How can I help you?'),
      'fallback greeting must be used when isError: true'
    );
    assert.ok(
      !mocks.calls.ttsTexts.includes('agent error text'),
      'error response text must NOT be TTS-rendered'
    );
  });

  it('uses fallback when bridge throws a connection error', async () => {
    const mocks = buildMocks({
      greetingQuery: () => Promise.reject(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-fallback-connrefused-uuid',
      mocks.defaultOptions
    );

    assert.ok(
      mocks.calls.ttsTexts.some(t => t === 'Hello! How can I help you?'),
      'fallback greeting must be used on connection error'
    );
  });

  it('uses fallback when bridge returns empty response', async () => {
    const mocks = buildMocks({
      greetingQuery: () => Promise.resolve({ response: '', isError: false })
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-fallback-empty-uuid',
      mocks.defaultOptions
    );

    assert.ok(
      mocks.calls.ttsTexts.some(t => t === 'Hello! How can I help you?'),
      'fallback greeting must be used when response is empty'
    );
  });

  it('FALLBACK_GREETING env var: uses custom value when set', async () => {
    process.env.FALLBACK_GREETING = 'Greetings, how may I assist?';

    // Must require fresh module to pick up new env var
    delete require.cache[require.resolve('../lib/conversation-loop')];
    const { runConversationLoop: freshLoop } = require('../lib/conversation-loop');

    const mocks = buildMocks({
      greetingQuery: () => Promise.resolve({ response: '', isError: false })
    });

    await freshLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-custom-fallback-uuid',
      mocks.defaultOptions
    );

    assert.ok(
      mocks.calls.ttsTexts.some(t => t === 'Greetings, how may I assist?'),
      'FALLBACK_GREETING env var must be used as fallback text'
    );

    // Restore
    delete require.cache[require.resolve('../lib/conversation-loop')];
  });
});

// ---------------------------------------------------------------------------
// Test 3: skipGreeting: true — no initial query sent
// ---------------------------------------------------------------------------

describe('dynamic-greeting: skipGreeting: true skips initial query', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  it('no bridge query sent when skipGreeting is true', async () => {
    let queryCalled = false;

    const mocks = buildMocks({ skipGreeting: true });
    mocks.mockBridge.query = () => {
      queryCalled = true;
      return Promise.resolve({ response: 'hi', isError: false });
    };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-skip-uuid',
      { ...mocks.defaultOptions, skipGreeting: true, claudeBridge: mocks.mockBridge }
    );

    assert.strictEqual(queryCalled, false, 'bridge query must NOT be called when skipGreeting is true');
  });

  it('no greeting TTS from bridge response when skipGreeting is true', async () => {
    const mocks = buildMocks({ skipGreeting: true });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-skip-tts-uuid',
      { ...mocks.defaultOptions, skipGreeting: true }
    );

    // No greeting from initial bridge query — bridge was never called for greeting
    // (maxTurns=0 may still produce a "been talking" TTS, but no bridge-sourced greeting)
    assert.ok(
      !mocks.calls.ttsTexts.some(t => t === 'Hello! How can I help you?' || t === 'Hi there!'),
      'no bridge-sourced greeting TTS must be generated when skipGreeting is true'
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: Caller hangup during greeting query
// ---------------------------------------------------------------------------

describe('dynamic-greeting: caller hangup during greeting aborts query', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  it('AbortController fires on hangup — no TTS greeting played', async () => {
    let abortSignal = null;
    let resolveQuery;

    const mocks = buildMocks({
      greetingQuery: (prompt, opts) => {
        abortSignal = opts && opts.signal;
        return new Promise((resolve, reject) => {
          resolveQuery = resolve;
          if (opts && opts.signal) {
            opts.signal.addEventListener('abort', () => {
              const err = new Error('canceled');
              err.code = 'ERR_CANCELED';
              reject(err);
            });
          }
        });
      }
    });

    const loopDone = runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-hangup-uuid',
      mocks.defaultOptions
    );

    // Let the loop reach the query (all pre-query steps are microtasks)
    await new Promise(r => setImmediate(r));

    // Simulate caller hangup
    mocks.mockDialog.fireDestroy();

    await loopDone;

    // No greeting TTS should have been called
    assert.strictEqual(
      mocks.calls.ttsTexts.length, 0,
      'no TTS greeting must play after caller hangup'
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: peerId is forwarded through greeting query options
// ---------------------------------------------------------------------------

describe('dynamic-greeting: peerId is forwarded to bridge query options', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  it('passes the caller peerId in bridge query options during greeting', async () => {
    let capturedOpts = null;

    const mocks = buildMocks({
      greetingQuery: (prompt, opts) => {
        capturedOpts = opts;
        return Promise.resolve({ response: 'Hello!', isError: false });
      }
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-peerid-uuid',
      { ...mocks.defaultOptions, peerId: '+15551234567' }
    );

    assert.ok(capturedOpts !== null, 'bridge query must have been called with options');
    assert.strictEqual(capturedOpts.peerId, '+15551234567', 'peerId must be forwarded to bridge query options');
  });

  it('passes null peerId when caller peerId is not set', async () => {
    let capturedOpts = null;

    const mocks = buildMocks({
      greetingQuery: (prompt, opts) => {
        capturedOpts = opts;
        return Promise.resolve({ response: 'Hello!', isError: false });
      }
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'dg-peerid-null-uuid',
      { ...mocks.defaultOptions, peerId: null }
    );

    assert.ok(capturedOpts !== null, 'bridge query must have been called');
    assert.strictEqual(capturedOpts.peerId, null, 'null peerId must be forwarded as-is');
  });
});

// ---------------------------------------------------------------------------
// Test 7: buildInitialQuery helper
// ---------------------------------------------------------------------------

describe('buildInitialQuery: returns correct prompt string', () => {
  const { buildInitialQuery } = require('../lib/conversation-loop');

  it('returns a non-empty string', () => {
    const q = buildInitialQuery();
    assert.strictEqual(typeof q, 'string');
    assert.ok(q.length > 0, 'query must be non-empty');
  });

  it('contains INITIAL GREETING REQUEST marker', () => {
    const q = buildInitialQuery();
    assert.ok(q.includes('[INITIAL GREETING REQUEST]'), 'query must contain [INITIAL GREETING REQUEST] marker');
  });

  it('instructs the agent to greet the caller', () => {
    const q = buildInitialQuery();
    assert.ok(q.toLowerCase().includes('greeting') || q.toLowerCase().includes('greet'), 'query must mention greeting');
  });
});

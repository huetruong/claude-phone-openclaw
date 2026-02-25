'use strict';

/**
 * Tests for hold music and unavailability message (Story 4.3)
 *
 * - Hold music starts on query dispatch and stops when response arrives
 * - Hold music loop restarts if file is shorter than query duration
 * - Unavailability message plays when bridge returns isError: true
 * - Unavailability message plays on HTTP 503 from plugin
 * - Pre-call availability check ends call before conversation starts
 * - Both bridges (openclaw + claude) return { response, isError } identically
 * - UNAVAILABLE_MESSAGE env var customises the message played
 * - UNAVAILABLE_AUDIO_URL env var skips TTS in favour of a static file
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

/**
 * Build minimal mocks so runConversationLoop() reaches the query() call.
 * @param {Object} bridgeOverrides - Override query/isAvailable on the bridge mock
 * @returns {{ calls, mockDialog, mockEndpoint, mockAudioForkServer, mockWhisperClient, mockBridge, mockTtsService }}
 */
function buildMocks(bridgeOverrides = {}) {
  const calls = {
    playUrls: [],
    apiCalls: [],
    endSession: []
  };

  let dialogDestroyHandler = null;

  const mockDialog = {
    on: (event, handler) => { if (event === 'destroy') dialogDestroyHandler = handler; },
    off: () => {}
  };

  const mockSession = {
    setCaptureEnabled: () => {},
    waitForUtterance: () => Promise.resolve({
      audio: Buffer.alloc(1600),
      reason: 'vad'
    }),
    forceFinalize: () => {}
  };

  const mockBridge = {
    query: bridgeOverrides.query || (() => Promise.resolve({ response: 'hello back', isError: false })),
    endSession: (callId) => { calls.endSession.push(callId); return Promise.resolve(); },
    ...bridgeOverrides
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
    transcribe: () => Promise.resolve('what time is it')
  };

  const mockTtsService = {
    generateSpeech: (text) => Promise.resolve('http://tts/' + encodeURIComponent(text.substring(0, 30)))
  };

  return {
    calls,
    dialogDestroyHandler: () => dialogDestroyHandler,
    mockDialog,
    mockEndpoint,
    mockAudioForkServer,
    mockWhisperClient,
    mockBridge,
    mockTtsService
  };
}

// ---------------------------------------------------------------------------
// Test 1: Hold music starts and stops correctly
// ---------------------------------------------------------------------------

describe('hold-music: starts on query dispatch and stops on response', () => {
  const { runConversationLoop, HOLD_MUSIC_URL } = require('../lib/conversation-loop');

  it('endpoint.play is called with HOLD_MUSIC_URL during query', async () => {
    const mocks = buildMocks();

    // Slow query — hold music should start before it resolves
    let holdMusicStarted = false;
    mocks.mockBridge.query = () => {
      holdMusicStarted = mocks.calls.playUrls.includes(HOLD_MUSIC_URL);
      return Promise.resolve({ response: 'response text', isError: false });
    };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'hm-start-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    assert.strictEqual(holdMusicStarted, true, 'hold music must start before query resolves');
  });

  it('hold music loops — play is called again after each file completion', async () => {
    let musicPlayCount = 0;
    const pendingPlayResolvers = [];
    let allowQueryResolve;
    let notifySecondPlay;
    const waitForSecondPlay = new Promise(r => { notifySecondPlay = r; });

    const mocks = buildMocks({
      query: () => new Promise(resolve => { allowQueryResolve = resolve; })
    });

    // Hold music plays pend until manually resolved; second play resolves waitForSecondPlay
    mocks.mockEndpoint.play = (url) => {
      mocks.calls.playUrls.push(url);
      if (url === HOLD_MUSIC_URL) {
        musicPlayCount++;
        if (musicPlayCount === 2) notifySecondPlay();
        return new Promise(r => pendingPlayResolvers.push(r));
      }
      return Promise.resolve();
    };

    const loopDone = runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'hm-loop-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    // All pre-hold-music awaits resolve as microtasks (all mocks return Promise.resolve).
    // By the next setImmediate macrotask the loop has reached hold music and is awaiting query.
    await new Promise(r => setImmediate(r));
    assert.strictEqual(musicPlayCount, 1, 'first hold music play must have started');

    // Resolve first play — loopHoldMusic's .then() schedules setImmediate(loopHoldMusic)
    pendingPlayResolvers.shift()();
    // Wait until loopHoldMusic fires and starts the second play (notification-based, no race)
    await waitForSecondPlay;
    assert.ok(musicPlayCount >= 2, `hold music must loop after first play ends (got ${musicPlayCount})`);

    // Finish: resolve query and any remaining pending plays then wait for clean exit
    allowQueryResolve({ response: 'done', isError: false });
    pendingPlayResolvers.forEach(r => r());
    await loopDone;
  });

  it('uuid_break is called after query response to stop hold music', async () => {
    const mocks = buildMocks();

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'hm-stop-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    const uuidBreakCalls = mocks.calls.apiCalls.filter(c => c.cmd === 'uuid_break');
    assert.ok(uuidBreakCalls.length >= 1, 'uuid_break must be called to stop hold music');
  });

  it('hold music stops before TTS response plays (uuid_break before response play)', async () => {
    const mocks = buildMocks();

    const events = [];
    mocks.mockEndpoint.play = (url) => {
      events.push({ type: 'play', url });
      mocks.calls.playUrls.push(url);
      return Promise.resolve();
    };
    mocks.mockEndpoint.api = (cmd, arg) => {
      events.push({ type: 'api', cmd, arg });
      mocks.calls.apiCalls.push({ cmd, arg });
      return Promise.resolve();
    };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'hm-order-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    const breakIdx = events.findIndex(e => e.type === 'api' && e.cmd === 'uuid_break');
    // Response URL from TTS is the last play after the query
    const responsePlays = events.filter(e => e.type === 'play' && e.url && e.url.includes('tts'));
    const lastResponsePlayIdx = events.lastIndexOf(responsePlays[responsePlays.length - 1]);

    assert.ok(breakIdx !== -1, 'uuid_break must be called');
    assert.ok(
      responsePlays.length > 0 && breakIdx < lastResponsePlayIdx,
      'uuid_break must occur before TTS response is played'
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: Unavailability message on bridge error (isError: true)
// ---------------------------------------------------------------------------

describe('unavailability-message: plays on bridge isError response', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  afterEach(() => {
    delete process.env.UNAVAILABLE_MESSAGE;
    delete process.env.UNAVAILABLE_AUDIO_URL;
  });

  it('plays TTS unavailability message when bridge returns isError: true (connection error)', async () => {
    const mocks = buildMocks({
      query: () => Promise.resolve({
        response: "I'm having trouble connecting.",
        isError: true
      })
    });

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'unavail-conn-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    // The loop should have played SOMETHING after the error (the unavailability TTS URL)
    const ttsPlays = mocks.calls.playUrls.filter(u => u && u.startsWith('http://tts/'));
    // At least one TTS after the thinking phrase — the unavailability message
    assert.ok(ttsPlays.length >= 2, 'TTS should be called for thinking phrase and unavailability message');
  });

  it('uses UNAVAILABLE_MESSAGE env var as TTS text', async () => {
    process.env.UNAVAILABLE_MESSAGE = 'Custom message: system offline';

    const mocks = buildMocks({
      query: () => Promise.resolve({ response: 'error', isError: true })
    });

    const generatedMessages = [];
    mocks.mockTtsService.generateSpeech = (text) => {
      generatedMessages.push(text);
      return Promise.resolve('http://tts/custom');
    };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'unavail-custom-msg-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    assert.ok(
      generatedMessages.includes('Custom message: system offline'),
      'UNAVAILABLE_MESSAGE must be used as TTS text'
    );
  });

  it('uses UNAVAILABLE_AUDIO_URL static file instead of TTS when set', async () => {
    process.env.UNAVAILABLE_AUDIO_URL = 'http://127.0.0.1:3000/static/unavailable.mp3';

    const mocks = buildMocks({
      query: () => Promise.resolve({ response: 'error', isError: true })
    });

    let unavailUrlPlayed = false;
    mocks.mockEndpoint.play = (url) => {
      if (url === 'http://127.0.0.1:3000/static/unavailable.mp3') unavailUrlPlayed = true;
      mocks.calls.playUrls.push(url);
      return Promise.resolve();
    };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'unavail-audio-url-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 1
      }
    );

    assert.strictEqual(unavailUrlPlayed, true, 'static UNAVAILABLE_AUDIO_URL must be played');
  });

  it('conversation loop breaks after unavailability message (no further turns)', async () => {
    const mocks = buildMocks({
      query: () => Promise.resolve({ response: 'error', isError: true })
    });

    let queryCalls = 0;
    mocks.mockBridge.query = () => {
      queryCalls++;
      return Promise.resolve({ response: 'error', isError: true });
    };

    await runConversationLoop(
      mocks.mockEndpoint, mocks.mockDialog, 'unavail-break-uuid',
      {
        audioForkServer: mocks.mockAudioForkServer,
        whisperClient: mocks.mockWhisperClient,
        claudeBridge: mocks.mockBridge,
        ttsService: mocks.mockTtsService,
        wsPort: 8080, deviceConfig: null, peerId: null, maxTurns: 5
      }
    );

    assert.strictEqual(queryCalls, 1, 'loop must break after first error — no retry');
  });
});

// ---------------------------------------------------------------------------
// Test 3: HTTP 503 from plugin triggers unavailability (via openclaw-bridge)
// ---------------------------------------------------------------------------

describe('unavailability-message: openclaw-bridge returns isError on HTTP 503', () => {
  const app = express();
  app.use(express.json());

  let queryHandler = null;
  app.post('/voice/query', (req, res) => {
    if (queryHandler) queryHandler(req, res);
    else res.json({ response: 'ok' });
  });
  app.get('/voice/health', (_req, res) => res.json({ ok: true }));

  let server;
  let testPort;

  function requireFreshBridge() {
    delete require.cache[require.resolve('../lib/openclaw-bridge')];
    return require('../lib/openclaw-bridge');
  }

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    testPort = server.address().port;
    process.env.OPENCLAW_WEBHOOK_URL = `http://127.0.0.1:${testPort}`;
    process.env.OPENCLAW_API_KEY = 'test-key';
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => { queryHandler = null; });

  it('returns { isError: true } on HTTP 503 response', async () => {
    queryHandler = (_req, res) => res.status(503).json({ error: 'agent unavailable' });
    const bridge = requireFreshBridge();
    const result = await bridge.query('test', { callId: 'test-503' });
    assert.strictEqual(result.isError, true, 'HTTP 503 must produce isError: true');
    assert.ok(typeof result.response === 'string', 'response must be a string');
    assert.ok(result.response.length > 0, 'response must be non-empty');
  });

  it('returns { isError: false } on successful response', async () => {
    queryHandler = (_req, res) => res.json({ response: 'agent says hi' });
    const bridge = requireFreshBridge();
    const result = await bridge.query('test', { callId: 'test-ok' });
    assert.strictEqual(result.isError, false, 'success must produce isError: false');
    assert.strictEqual(result.response, 'agent says hi');
  });

  it('returns { isError: true } on connection error (ECONNREFUSED)', async () => {
    process.env.OPENCLAW_WEBHOOK_URL = 'http://127.0.0.1:1'; // unreachable
    const bridge = requireFreshBridge();
    const result = await bridge.query('test', { callId: 'test-conn-err' });
    assert.strictEqual(result.isError, true, 'connection error must produce isError: true');
    process.env.OPENCLAW_WEBHOOK_URL = `http://127.0.0.1:${testPort}`;
  });
});

// ---------------------------------------------------------------------------
// Test 4: Pre-call availability check in sip-handler
// ---------------------------------------------------------------------------

describe('pre-call availability: sip-handler rejects call when bridge is down', () => {
  const { handleInvite } = require('../lib/sip-handler');

  function buildSipMocks(isAvailableResult) {
    const calls = { playUrls: [], connectCallerCalled: false, resSendCodes: [] };

    const mockEndpoint = {
      play: (url) => { calls.playUrls.push(url); return Promise.resolve(); },
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve(),
      on: () => {},
      off: () => {},
      uuid: 'sip-test-uuid',
      destroy: () => Promise.resolve()
    };

    const mockDialog = {
      on: () => {},
      off: () => {},
      destroy: () => {}
    };

    const mockMediaServer = {
      connectCaller: () => {
        calls.connectCallerCalled = true;
        return Promise.resolve({ endpoint: mockEndpoint, dialog: mockDialog });
      }
    };

    const mockBridge = {
      isAvailable: () => Promise.resolve(isAvailableResult),
      query: () => Promise.resolve({ response: 'hi', isError: false }),
      endSession: () => Promise.resolve()
    };

    const mockTtsService = {
      generateSpeech: (text) => Promise.resolve('http://tts/' + encodeURIComponent(text.substring(0, 20)))
    };

    const mockAudioForkServer = {
      expectSession: () => new Promise(() => {}), // never resolves — conversation won't start
      cancelExpectation: () => {},
      emit: () => {}
    };

    const mockWhisperClient = { transcribe: () => Promise.resolve('hello') };

    const mockReq = {
      get: (h) => {
        if (h === 'From') return '<sip:+15551234567@pbx.example.com>';
        if (h === 'To') return '<sip:9000@pbx.example.com>';
        return '';
      },
      body: ''
    };

    const mockRes = { send: (code) => { calls.resSendCodes.push(code); } };

    return {
      calls,
      mockReq,
      mockRes,
      options: {
        mediaServer: mockMediaServer,
        deviceRegistry: null,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        wsPort: 8080
      }
    };
  }

  it('sends SIP 480 and never answers call when bridge is unavailable', async () => {
    const { calls, mockReq, mockRes, options } = buildSipMocks(false);

    await handleInvite(mockReq, mockRes, options);

    assert.ok(calls.resSendCodes.includes(480), 'SIP 480 must be sent when bridge is unavailable');
    assert.strictEqual(calls.connectCallerCalled, false, 'call must not be answered when bridge is unavailable');
  });

  it('answers call (connectCaller) when bridge is available', async () => {
    const { calls, mockReq, mockRes, options } = buildSipMocks(true);

    // When bridge is available, conversation loop starts but audio fork never resolves.
    // Race to verify the initial path (connectCaller) was taken.
    await Promise.race([
      handleInvite(mockReq, mockRes, options),
      new Promise(resolve => setTimeout(resolve, 200))
    ]);

    assert.strictEqual(calls.connectCallerCalled, true, 'call must be answered when bridge is available');
    assert.ok(!calls.resSendCodes.includes(480), 'SIP 480 must not be sent when bridge is available');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Brownfield parity — both bridges return identical { response, isError } shape
// ---------------------------------------------------------------------------

describe('brownfield parity: openclaw-bridge and claude-bridge return same shape', () => {
  const openclawApp = express();
  openclawApp.use(express.json());
  let openclawQueryHandler = null;
  openclawApp.post('/voice/query', (req, res) => {
    if (openclawQueryHandler) openclawQueryHandler(req, res);
    else res.json({ response: 'default' });
  });
  openclawApp.get('/voice/health', (_req, res) => res.json({ ok: true }));

  const claudeApp = express();
  claudeApp.use(express.json());
  let claudeQueryHandler = null;
  claudeApp.post('/ask', (req, res) => {
    if (claudeQueryHandler) claudeQueryHandler(req, res);
    else res.json({ success: true, response: 'default', duration_ms: 10 });
  });
  claudeApp.get('/health', (_req, res) => res.json({ ok: true }));

  let openclawServer, claudeServer;
  let openclawPort, claudePort;

  function requireFreshOpenclawBridge() {
    delete require.cache[require.resolve('../lib/openclaw-bridge')];
    return require('../lib/openclaw-bridge');
  }

  function requireFreshClaudeBridge() {
    delete require.cache[require.resolve('../lib/claude-bridge')];
    return require('../lib/claude-bridge');
  }

  before(async () => {
    openclawServer = http.createServer(openclawApp);
    claudeServer = http.createServer(claudeApp);
    await new Promise(resolve => openclawServer.listen(0, resolve));
    await new Promise(resolve => claudeServer.listen(0, resolve));
    openclawPort = openclawServer.address().port;
    claudePort = claudeServer.address().port;

    process.env.OPENCLAW_WEBHOOK_URL = `http://127.0.0.1:${openclawPort}`;
    process.env.OPENCLAW_API_KEY = 'test-key';
    process.env.CLAUDE_API_URL = `http://127.0.0.1:${claudePort}`;
  });

  after(async () => {
    if (openclawServer) await new Promise(resolve => openclawServer.close(resolve));
    if (claudeServer) await new Promise(resolve => claudeServer.close(resolve));
  });

  beforeEach(() => {
    openclawQueryHandler = null;
    claudeQueryHandler = null;
  });

  it('both return { response: string, isError: false } on success', async () => {
    openclawQueryHandler = (_req, res) => res.json({ response: 'openclaw response' });
    claudeQueryHandler = (_req, res) => res.json({ success: true, response: 'claude response', duration_ms: 5 });

    const openclawBridge = requireFreshOpenclawBridge();
    const claudeBridge = requireFreshClaudeBridge();

    const [ocResult, clResult] = await Promise.all([
      openclawBridge.query('test', { callId: 'parity-ok-oc' }),
      claudeBridge.query('test', { callId: 'parity-ok-cl' })
    ]);

    assert.strictEqual(typeof ocResult, 'object', 'openclaw-bridge must return object');
    assert.strictEqual(ocResult.isError, false);
    assert.strictEqual(typeof ocResult.response, 'string');

    assert.strictEqual(typeof clResult, 'object', 'claude-bridge must return object');
    assert.strictEqual(clResult.isError, false);
    assert.strictEqual(typeof clResult.response, 'string');
  });

  it('both return { response: string, isError: true } on HTTP 503', async () => {
    openclawQueryHandler = (_req, res) => res.status(503).json({ error: 'agent unavailable' });
    claudeQueryHandler = (_req, res) => res.status(503).json({ error: 'agent unavailable' });

    const openclawBridge = requireFreshOpenclawBridge();
    const claudeBridge = requireFreshClaudeBridge();

    const [ocResult, clResult] = await Promise.all([
      openclawBridge.query('test', { callId: 'parity-503-oc' }),
      claudeBridge.query('test', { callId: 'parity-503-cl' })
    ]);

    assert.strictEqual(ocResult.isError, true, 'openclaw-bridge: 503 must produce isError: true');
    assert.strictEqual(typeof ocResult.response, 'string');
    assert.ok(ocResult.response.length > 0);

    assert.strictEqual(clResult.isError, true, 'claude-bridge: 503 must produce isError: true');
    assert.strictEqual(typeof clResult.response, 'string');
    assert.ok(clResult.response.length > 0);
  });

  it('both throw (not return) on ERR_CANCELED abort — conversation loop handles exit', async () => {
    openclawQueryHandler = (_req, res) => setTimeout(() => res.json({ response: 'late' }), 500);
    claudeQueryHandler = (_req, res) => setTimeout(() => res.json({ success: true, response: 'late', duration_ms: 500 }), 500);

    const openclawBridge = requireFreshOpenclawBridge();
    const claudeBridge = requireFreshClaudeBridge();

    const ocAc = new AbortController();
    const clAc = new AbortController();
    setTimeout(() => { ocAc.abort(); clAc.abort(); }, 50);

    await assert.rejects(
      () => openclawBridge.query('test', { callId: 'abort-oc', signal: ocAc.signal }),
      (err) => err.code === 'ERR_CANCELED' || err.name === 'CanceledError',
      'openclaw-bridge must throw ERR_CANCELED on abort'
    );

    await assert.rejects(
      () => claudeBridge.query('test', { callId: 'abort-cl', signal: clAc.signal }),
      (err) => err.code === 'ERR_CANCELED' || err.name === 'CanceledError',
      'claude-bridge must throw ERR_CANCELED on abort'
    );
  });

  it('isAvailable() on both bridges accepts a timeout option', async () => {
    const openclawBridge = requireFreshOpenclawBridge();
    const claudeBridge = requireFreshClaudeBridge();

    const [ocAvail, clAvail] = await Promise.all([
      openclawBridge.isAvailable({ timeout: 2000 }),
      claudeBridge.isAvailable({ timeout: 2000 })
    ]);

    assert.strictEqual(typeof ocAvail, 'boolean', 'openclaw isAvailable must return boolean');
    assert.strictEqual(typeof clAvail, 'boolean', 'claude isAvailable must return boolean');
    // Both servers are up in this test
    assert.strictEqual(ocAvail, true);
    assert.strictEqual(clAvail, true);
  });
});

// ---------------------------------------------------------------------------
// Test 6: getUnavailabilityUrl helper
// ---------------------------------------------------------------------------

describe('getUnavailabilityUrl helper', () => {
  const { getUnavailabilityUrl } = require('../lib/conversation-loop');

  afterEach(() => {
    delete process.env.UNAVAILABLE_MESSAGE;
    delete process.env.UNAVAILABLE_AUDIO_URL;
  });

  it('returns UNAVAILABLE_AUDIO_URL when set (no TTS call)', async () => {
    process.env.UNAVAILABLE_AUDIO_URL = 'http://example.com/unavailable.mp3';

    let ttsCalled = false;
    const mockTts = { generateSpeech: () => { ttsCalled = true; return Promise.resolve('tts-url'); } };

    const url = await getUnavailabilityUrl(mockTts, null);

    assert.strictEqual(url, 'http://example.com/unavailable.mp3');
    assert.strictEqual(ttsCalled, false, 'TTS must not be called when UNAVAILABLE_AUDIO_URL is set');
  });

  it('calls TTS with UNAVAILABLE_MESSAGE when set', async () => {
    process.env.UNAVAILABLE_MESSAGE = 'System offline right now.';

    let ttsText = null;
    const mockTts = { generateSpeech: (text) => { ttsText = text; return Promise.resolve('tts-url'); } };

    await getUnavailabilityUrl(mockTts, null);

    assert.strictEqual(ttsText, 'System offline right now.');
  });

  it('calls TTS with default message when no env vars set', async () => {
    let ttsText = null;
    const mockTts = { generateSpeech: (text) => { ttsText = text; return Promise.resolve('tts-url'); } };

    await getUnavailabilityUrl(mockTts, null);

    assert.ok(ttsText && ttsText.includes('unavailable'), 'default message must mention unavailability');
  });
});

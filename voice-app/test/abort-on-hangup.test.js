'use strict';

/**
 * Tests for in-flight query abort on hangup (Story 4.2)
 *
 * - AbortController wired in conversation loop
 * - Both bridges handle ERR_CANCELED correctly
 * - endSession still called after abort
 * - All session resources released after abort
 * - Plugin handles client disconnect gracefully
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

// ---------------------------------------------------------------------------
// Test 1: onDialogDestroy fires during query() → in-flight request is aborted
// ---------------------------------------------------------------------------

describe('abort-on-hangup: conversation loop abort', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  /**
   * Helper: build mocks that reach the query() call inside the while loop.
   * The mock session simulates a successful audio fork session with a single
   * utterance that produces a transcript, reaching the claudeBridge.query() call.
   */
  function buildMocks(overrides = {}) {
    const calls = {
      endSession: [],
      queryAborted: false,
      forkAudioStopped: false,
      dtmfOff: false,
      cancelExpectation: false,
      dialogOffDestroy: false
    };

    let dialogDestroyHandler = null;

    const mockDialog = {
      on: (event, handler) => {
        if (event === 'destroy') dialogDestroyHandler = handler;
      },
      off: (event) => {
        if (event === 'destroy') calls.dialogOffDestroy = true;
      }
    };

    // Trigger hangup after a delay (simulates caller hanging up during query)
    function triggerHangup() {
      if (dialogDestroyHandler) dialogDestroyHandler();
    }

    const mockSession = {
      setCaptureEnabled: () => {},
      waitForUtterance: () => Promise.resolve({
        audio: Buffer.alloc(1600), // 100ms of 16kHz PCM
        reason: 'vad'
      }),
      forceFinalize: () => {}
    };

    const mockBridge = {
      query: overrides.query || ((prompt, options) => {
        // Simulate a slow query — hangup fires during this
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            calls.queryAborted = true;
            const err = new Error('canceled');
            err.code = 'ERR_CANCELED';
            err.name = 'CanceledError';
            reject(err);
          };
          if (options.signal) {
            if (options.signal.aborted) {
              onAbort();
              return;
            }
            options.signal.addEventListener('abort', onAbort, { once: true });
          }
          // Trigger hangup mid-query
          setTimeout(() => triggerHangup(), 10);
        });
      }),
      endSession: (callId) => {
        calls.endSession.push(callId);
        return Promise.resolve();
      }
    };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => {
        calls.forkAudioStopped = true;
        return Promise.resolve();
      },
      api: () => Promise.resolve(),
      on: () => {},
      off: () => { calls.dtmfOff = true; },
      uuid: 'test-endpoint-uuid'
    };

    const mockAudioForkServer = {
      expectSession: () => Promise.resolve(mockSession),
      cancelExpectation: () => { calls.cancelExpectation = true; },
      emit: () => {}
    };

    const mockWhisperClient = {
      transcribe: () => Promise.resolve('hello world')
    };

    const mockTtsService = {
      generateSpeech: () => Promise.resolve('http://tts/url')
    };

    return {
      calls,
      triggerHangup,
      mockDialog,
      mockEndpoint,
      mockAudioForkServer,
      mockWhisperClient,
      mockBridge,
      mockTtsService
    };
  }

  it('aborts in-flight query when dialog is destroyed (signal.aborted === true)', async () => {
    const { calls, mockDialog, mockEndpoint, mockAudioForkServer, mockWhisperClient, mockBridge, mockTtsService } = buildMocks();

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'abort-test-uuid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: null,
        peerId: null
      }
    );

    assert.strictEqual(calls.queryAborted, true, 'in-flight query must be aborted via signal');
  });

  it('calls endSession(callId) in finally even when query is aborted', async () => {
    const { calls, mockDialog, mockEndpoint, mockAudioForkServer, mockWhisperClient, mockBridge, mockTtsService } = buildMocks();

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'abort-endsession-uuid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: null,
        peerId: null
      }
    );

    assert.strictEqual(calls.endSession.length, 1, 'endSession must be called exactly once');
    assert.strictEqual(calls.endSession[0], 'abort-endsession-uuid', 'endSession must receive correct callId');
  });

  it('releases all session resources after abort (audio fork, DTMF, expectations)', async () => {
    const { calls, mockDialog, mockEndpoint, mockAudioForkServer, mockWhisperClient, mockBridge, mockTtsService } = buildMocks();

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'abort-cleanup-uuid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: null,
        peerId: null
      }
    );

    assert.strictEqual(calls.forkAudioStopped, true, 'audio fork must be stopped');
    assert.strictEqual(calls.dtmfOff, true, 'DTMF handler must be removed');
    assert.strictEqual(calls.cancelExpectation, true, 'session expectations must be cancelled');
    assert.strictEqual(calls.dialogOffDestroy, true, 'dialog destroy listener must be removed');
  });

  it('does not attempt TTS after abort (no endpoint.play after query abort)', async () => {
    let playCallsAfterAbort = 0;
    let abortFired = false;

    const { mockDialog, mockAudioForkServer, mockWhisperClient, mockTtsService } = buildMocks();

    let dialogDestroyHandler = null;
    mockDialog.on = (event, handler) => {
      if (event === 'destroy') dialogDestroyHandler = handler;
    };

    const mockEndpoint = {
      play: () => {
        if (abortFired) playCallsAfterAbort++;
        return Promise.resolve();
      },
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve(),
      on: () => {},
      off: () => {},
      uuid: 'test-endpoint-uuid'
    };

    const mockBridge = {
      query: (prompt, options) => {
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            abortFired = true;
            const err = new Error('canceled');
            err.code = 'ERR_CANCELED';
            err.name = 'CanceledError';
            reject(err);
          };
          if (options.signal) {
            options.signal.addEventListener('abort', onAbort, { once: true });
          }
          setTimeout(() => { if (dialogDestroyHandler) dialogDestroyHandler(); }, 10);
        });
      },
      endSession: () => Promise.resolve()
    };

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'no-tts-after-abort-uuid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: null,
        peerId: null
      }
    );

    assert.strictEqual(playCallsAfterAbort, 0, 'endpoint.play must not be called after abort');
  });
});

// ---------------------------------------------------------------------------
// Test 2: query() with aborted signal throws ERR_CANCELED (both bridges)
// ---------------------------------------------------------------------------

describe('abort-on-hangup: openclaw-bridge abort support', () => {
  const app = express();
  app.use(express.json());

  let queryHandler = null;

  app.post('/voice/query', (req, res) => {
    if (queryHandler) queryHandler(req, res);
    else res.json({ response: 'default' });
  });

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
    process.env.OPENCLAW_WEBHOOK_URL = 'http://127.0.0.1:' + testPort;
    process.env.OPENCLAW_API_KEY = 'test-key';
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    queryHandler = null;
  });

  it('throws ERR_CANCELED when signal is aborted during request', async () => {
    queryHandler = (_req, res) => {
      // Delay response so abort fires first
      setTimeout(() => res.json({ response: 'too late' }), 500);
    };

    const bridge = requireFreshBridge();
    const ac = new AbortController();

    // Abort after 50ms
    setTimeout(() => ac.abort(), 50);

    await assert.rejects(
      () => bridge.query('test prompt', { callId: 'abort-1', signal: ac.signal }),
      (err) => {
        return err.code === 'ERR_CANCELED' || err.name === 'CanceledError';
      },
      'query() must throw ERR_CANCELED when signal is aborted'
    );
  });

  it('throws ERR_CANCELED when signal is already aborted before request', async () => {
    const bridge = requireFreshBridge();
    const ac = new AbortController();
    ac.abort(); // Abort before calling query

    await assert.rejects(
      () => bridge.query('test prompt', { callId: 'abort-2', signal: ac.signal }),
      (err) => {
        return err.code === 'ERR_CANCELED' || err.name === 'CanceledError';
      },
      'query() must throw ERR_CANCELED when signal is pre-aborted'
    );
  });

  it('works normally without signal (backward compatible)', async () => {
    queryHandler = (req, res) => res.json({ response: 'normal response' });
    const bridge = requireFreshBridge();
    const result = await bridge.query('test prompt', { callId: 'no-abort' });
    assert.strictEqual(result.response, 'normal response');
    assert.strictEqual(result.isError, false);
  });
});

describe('abort-on-hangup: claude-bridge abort support', () => {
  const app = express();
  app.use(express.json());

  let askHandler = null;

  app.post('/ask', (req, res) => {
    if (askHandler) askHandler(req, res);
    else res.json({ success: true, response: 'default', duration_ms: 10 });
  });

  let server;
  let testPort;

  function requireFreshBridge() {
    delete require.cache[require.resolve('../lib/claude-bridge')];
    return require('../lib/claude-bridge');
  }

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    testPort = server.address().port;
    process.env.CLAUDE_API_URL = 'http://127.0.0.1:' + testPort;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    askHandler = null;
  });

  it('throws ERR_CANCELED when signal is aborted during request', async () => {
    askHandler = (_req, res) => {
      setTimeout(() => res.json({ success: true, response: 'too late', duration_ms: 500 }), 500);
    };

    const bridge = requireFreshBridge();
    const ac = new AbortController();

    setTimeout(() => ac.abort(), 50);

    await assert.rejects(
      () => bridge.query('test prompt', { callId: 'abort-1', signal: ac.signal }),
      (err) => {
        return err.code === 'ERR_CANCELED' || err.name === 'CanceledError';
      },
      'query() must throw ERR_CANCELED when signal is aborted'
    );
  });

  it('throws ERR_CANCELED when signal is already aborted before request', async () => {
    const bridge = requireFreshBridge();
    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      () => bridge.query('test prompt', { callId: 'abort-2', signal: ac.signal }),
      (err) => {
        return err.code === 'ERR_CANCELED' || err.name === 'CanceledError';
      },
      'query() must throw ERR_CANCELED when signal is pre-aborted'
    );
  });

  it('works normally without signal (backward compatible)', async () => {
    askHandler = (req, res) => res.json({ success: true, response: 'normal response', duration_ms: 10 });
    const bridge = requireFreshBridge();
    const result = await bridge.query('test prompt', { callId: 'no-abort' });
    assert.strictEqual(result.response, 'normal response');
    assert.strictEqual(result.isError, false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Plugin /voice/query handler does not crash when client disconnects
// ---------------------------------------------------------------------------

describe('abort-on-hangup: plugin handles client disconnect gracefully', () => {
  const { createServer } = require('../../openclaw-plugin/src/webhook-server');

  it('does not crash when client disconnects before response is sent', async () => {
    let queryStarted = false;
    let queryFinished = false;

    const app = createServer({
      apiKey: 'test-key',
      bindings: [{ accountId: 'morpheus', agentId: 'morpheus' }],
      accounts: [],
      queryAgent: async () => {
        queryStarted = true;
        // Simulate slow agent processing
        await new Promise(resolve => setTimeout(resolve, 200));
        queryFinished = true;
        return 'agent response';
      }
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
      // Make a request and abort it before the agent responds
      const ac = new AbortController();

      const fetchPromise = fetch(`http://127.0.0.1:${port}/voice/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key'
        },
        body: JSON.stringify({ prompt: 'hello', callId: 'disconnect-test', accountId: 'morpheus' }),
        signal: ac.signal
      }).catch(() => {}); // Ignore fetch abort error

      // Wait for query to start, then abort
      await new Promise(resolve => {
        const check = setInterval(() => {
          if (queryStarted) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      ac.abort();
      await fetchPromise;

      // Wait for the agent query to finish (server-side should not crash)
      await new Promise(resolve => setTimeout(resolve, 300));

      // If we got here without an uncaught exception, the test passes.
      // The server is still alive — verify with a health check.
      const healthRes = await fetch(`http://127.0.0.1:${port}/voice/health`);
      const healthData = await healthRes.json();
      assert.strictEqual(healthData.ok, true, 'server must still be alive after client disconnect');
      assert.strictEqual(queryFinished, true, 'agent query should complete even if client disconnected');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

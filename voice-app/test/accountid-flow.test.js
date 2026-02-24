'use strict';

/**
 * Tests for accountId flow through call sites (Story 2.1, Task 5)
 *
 * Verifies that accountId is passed from deviceConfig to claudeBridge.query()
 * at each call site. sip-handler's inner conversationLoop is a legacy function
 * requiring full SIP/FreeSWITCH infrastructure; its accountId change is a
 * one-liner covered by code review and DeviceRegistry tests.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// conversation-loop: prime query passes accountId (AC: #1, #2)
// ---------------------------------------------------------------------------

describe('conversation-loop accountId flow', () => {
  it('passes accountId from deviceConfig to bridge query (prime query path)', async () => {
    const capturedCalls = [];

    const mockBridge = {
      query: (prompt, opts) => {
        capturedCalls.push({ prompt, opts });
        return Promise.resolve('ok');
      },
      endSession: () => Promise.resolve()
    };

    const mockDialog = { on: () => {}, off: () => {} };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };

    // expectSession throws → short-circuits loop before VAD/transcription
    const mockAudioForkServer = {
      expectSession: () => { throw new Error('test: short-circuit fork'); },
      cancelExpectation: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };
    const mockWhisperClient = {};

    const { runConversationLoop } = require('../lib/conversation-loop');

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'test-call-uuid-prime',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        initialContext: 'Alert: disk usage at 95%',
        skipGreeting: true,
        deviceConfig: { name: 'Morpheus', accountId: 'morpheus', prompt: 'You are Morpheus.' }
      }
    );

    assert.strictEqual(capturedCalls.length, 1, 'bridge.query should be called once (prime query)');
    assert.strictEqual(capturedCalls[0].opts.accountId, 'morpheus',
      'prime query should include accountId from deviceConfig');
    assert.ok(capturedCalls[0].opts.isSystemPrime,
      'prime query should have isSystemPrime flag');
  });

  it('passes undefined accountId when deviceConfig has no accountId', async () => {
    const capturedCalls = [];

    const mockBridge = {
      query: (prompt, opts) => {
        capturedCalls.push({ prompt, opts });
        return Promise.resolve('ok');
      },
      endSession: () => Promise.resolve()
    };

    const mockDialog = { on: () => {}, off: () => {} };
    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };
    const mockAudioForkServer = {
      expectSession: () => { throw new Error('test: short-circuit fork'); },
      cancelExpectation: () => {}
    };
    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

    const { runConversationLoop } = require('../lib/conversation-loop');

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'test-call-uuid-noaccountid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: {},
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        initialContext: 'Context without accountId',
        skipGreeting: true,
        deviceConfig: null
      }
    );

    assert.strictEqual(capturedCalls.length, 1, 'bridge.query should be called once');
    assert.strictEqual(capturedCalls[0].opts.accountId, undefined,
      'accountId should be undefined when deviceConfig is null');
  });

  it('passes accountId from deviceConfig to bridge query (main conversation query path)', async () => {
    const capturedCalls = [];

    const mockBridge = {
      query: (prompt, opts) => {
        capturedCalls.push({ prompt, opts });
        return Promise.resolve('Response text');
      },
      endSession: () => Promise.resolve()
    };

    const mockDialog = { on: () => {}, off: () => {} };
    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve(),
      on: () => {},
      off: () => {}
    };

    const mockSession = {
      setCaptureEnabled: () => {},
      waitForUtterance: () => Promise.resolve({ audio: Buffer.alloc(100), reason: 'vad' }),
      forceFinalize: () => {}
    };

    const mockAudioForkServer = {
      expectSession: () => Promise.resolve(mockSession),
      cancelExpectation: () => {},
      emit: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };
    const mockWhisperClient = {
      transcribe: () => Promise.resolve('Hello there')
    };

    const { runConversationLoop } = require('../lib/conversation-loop');

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'test-call-main-query',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: mockWhisperClient,
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        skipGreeting: true,
        deviceConfig: { name: 'Morpheus', accountId: 'morpheus', prompt: 'You are Morpheus.' },
        maxTurns: 1
      }
    );

    const mainQuery = capturedCalls.find(c => !c.opts.isSystemPrime);
    assert.ok(mainQuery, 'main conversation query should be called');
    assert.strictEqual(mainQuery.opts.accountId, 'morpheus',
      'main conversation query should include accountId from deviceConfig');
  });
});

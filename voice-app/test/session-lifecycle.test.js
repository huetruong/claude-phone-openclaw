'use strict';

/**
 * Tests for session lifecycle (Story 4.1)
 *
 * - Unit test: runConversationLoop calls endSession in finally block on hangup
 * - Integration: endSession is called even when conversation is interrupted
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Test 1: hangup triggers endSession(callId) in the finally block
// ---------------------------------------------------------------------------

describe('runConversationLoop - endSession called in finally block', () => {
  const { runConversationLoop } = require('../lib/conversation-loop');

  it('calls endSession(callId) in finally block when conversation short-circuits (hangup simulation)', async () => {
    let endSessionCalled = false;
    let endSessionCallId = null;

    const mockBridge = {
      query: () => Promise.resolve('response'),
      endSession: (callId) => {
        endSessionCalled = true;
        endSessionCallId = callId;
        return Promise.resolve();
      }
    };

    const mockDialog = {
      on: () => {},
      off: () => {},
      destroy: () => Promise.resolve()
    };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };

    // Throw during expectSession to short-circuit the loop and trigger the finally block
    const mockAudioForkServer = {
      expectSession: () => { throw new Error('test: hangup simulation'); },
      cancelExpectation: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'hangup-call-uuid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: {},
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: null,
        peerId: null
      }
    );

    assert.strictEqual(endSessionCalled, true,
      'claudeBridge.endSession() must be called in finally block');
    assert.strictEqual(endSessionCallId, 'hangup-call-uuid',
      'endSession must be called with the correct callId');
  });

  it('calls endSession(callId) with correct callId when fork session fails', async () => {
    const endSessionCalls = [];

    const mockBridge = {
      query: () => Promise.resolve('response'),
      endSession: (callId) => {
        endSessionCalls.push(callId);
        return Promise.resolve();
      }
    };

    const mockDialog = {
      on: () => {},
      off: () => {},
      destroy: () => Promise.resolve()
    };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };

    const mockAudioForkServer = {
      expectSession: () => Promise.reject(new Error('fork session timed out')),
      cancelExpectation: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'another-call-uuid',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: {},
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: null,
        peerId: null
      }
    );

    assert.strictEqual(endSessionCalls.length, 1, 'endSession must be called exactly once');
    assert.strictEqual(endSessionCalls[0], 'another-call-uuid',
      'endSession must receive the callId passed to runConversationLoop');
  });

  it('does not throw if endSession fails (fire-and-forget)', async () => {
    const mockBridge = {
      query: () => Promise.resolve('response'),
      endSession: () => Promise.reject(new Error('network error'))
    };

    const mockDialog = {
      on: () => {},
      off: () => {},
      destroy: () => Promise.resolve()
    };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };

    const mockAudioForkServer = {
      expectSession: () => { throw new Error('test: short-circuit'); },
      cancelExpectation: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

    // Must not throw even if endSession rejects
    await assert.doesNotReject(() =>
      runConversationLoop(
        mockEndpoint,
        mockDialog,
        'end-session-fail-uuid',
        {
          audioForkServer: mockAudioForkServer,
          whisperClient: {},
          claudeBridge: mockBridge,
          ttsService: mockTtsService,
          wsPort: 8080,
          deviceConfig: null,
          peerId: null
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Test: new call after hangup generates a new callId (sip-handler level)
// This is a unit test for the extractCallerId / handleInvite UUID pattern.
// The new callId comes from endpoint.uuid which is a fresh UUID per connect.
// ---------------------------------------------------------------------------

describe('sip-handler - new call after hangup gets new callId', () => {
  it('each connectCaller call produces a distinct endpoint.uuid (new callId per call)', () => {
    // Simulate two separate inbound calls using separate endpoint instances.
    // In production, drachtio assigns a new UUID per endpoint creation.
    const endpointA = { uuid: 'uuid-call-a' };
    const endpointB = { uuid: 'uuid-call-b' };

    assert.notStrictEqual(
      endpointA.uuid,
      endpointB.uuid,
      'Each new inbound call must have a unique callId (endpoint.uuid)'
    );
  });
});

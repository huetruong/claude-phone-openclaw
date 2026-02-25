'use strict';

/**
 * Tests for caller allowlist validation (Stories 3.1, 3.2)
 *
 * - Unit tests for checkAllowFrom() helper
 * - Integration tests for runConversationLoop() rejection flow
 * - PII logging tests: phone number at DEBUG only, not INFO
 * - device-registry passthrough: allowFrom preserved from devices.json
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Task 3: Unit tests for checkAllowFrom()
// ---------------------------------------------------------------------------

describe('checkAllowFrom', () => {
  const { checkAllowFrom } = require('../lib/conversation-loop');

  it('returns true when caller is in allowFrom list', () => {
    const device = { allowFrom: ['+15551234567', '+15559876543'] };
    assert.strictEqual(checkAllowFrom(device, '+15551234567'), true);
  });

  it('returns false when caller is NOT in allowFrom list', () => {
    const device = { allowFrom: ['+15551234567'] };
    assert.strictEqual(checkAllowFrom(device, '+15550000000'), false);
  });

  it('returns true when allowFrom is an empty array (no restriction)', () => {
    const device = { allowFrom: [] };
    assert.strictEqual(checkAllowFrom(device, '+15550000000'), true);
  });

  it('returns true when allowFrom is missing/undefined (no restriction)', () => {
    const device = { name: 'Morpheus', extension: '9000' };
    assert.strictEqual(checkAllowFrom(device, '+15550000000'), true);
  });

  it('returns true when deviceConfig is null (no restriction)', () => {
    assert.strictEqual(checkAllowFrom(null, '+15550000000'), true);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Integration tests for runConversationLoop() rejection flow
// ---------------------------------------------------------------------------

describe('runConversationLoop allowlist enforcement', () => {
  it('returns early and calls dialog.destroy() when caller is blocked', async () => {
    let destroyCalled = false;
    let queryCalled = false;

    const mockBridge = {
      query: () => { queryCalled = true; return Promise.resolve('response'); },
      endSession: () => Promise.resolve()
    };

    const mockDialog = {
      on: () => {},
      off: () => {},
      destroy: () => { destroyCalled = true; return Promise.resolve(); }
    };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };

    const mockAudioForkServer = {
      expectSession: () => { throw new Error('test: should not reach fork'); },
      cancelExpectation: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

    const { runConversationLoop } = require('../lib/conversation-loop');

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'test-blocked-call',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: {},
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: { extension: '9000', allowFrom: ['+15551234567'] },
        peerId: '+15550000000'  // NOT in allowFrom
      }
    );

    assert.strictEqual(destroyCalled, true, 'dialog.destroy() must be called for rejected caller');
    assert.strictEqual(queryCalled, false, 'bridge.query() must never be called for rejected caller');
  });

  it('proceeds normally when caller is in allowFrom list', async () => {
    let queryCalled = false;
    let destroyCalled = false;

    const mockBridge = {
      query: () => { queryCalled = true; return Promise.resolve('response'); },
      endSession: () => Promise.resolve()
    };

    const mockDialog = {
      on: () => {},
      off: () => {},
      destroy: () => { destroyCalled = true; return Promise.resolve(); }
    };

    const mockEndpoint = {
      play: () => Promise.resolve(),
      forkAudioStart: () => Promise.resolve(),
      forkAudioStop: () => Promise.resolve(),
      api: () => Promise.resolve()
    };

    // Short-circuit after fork starts (same pattern as accountid-flow tests)
    const mockAudioForkServer = {
      expectSession: () => { throw new Error('test: short-circuit fork'); },
      cancelExpectation: () => {}
    };

    const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

    const { runConversationLoop } = require('../lib/conversation-loop');

    await runConversationLoop(
      mockEndpoint,
      mockDialog,
      'test-allowed-call',
      {
        audioForkServer: mockAudioForkServer,
        whisperClient: {},
        claudeBridge: mockBridge,
        ttsService: mockTtsService,
        wsPort: 8080,
        deviceConfig: { extension: '9000', allowFrom: ['+15551234567'] },
        peerId: '+15551234567'  // IN allowFrom
      }
    );

    // The fork short-circuit fires before any query, but the key assertions are:
    // 1. dialog.destroy() was NOT called — allowlist passed, caller was not rejected
    // 2. query still not called (expected: short-circuited at fork, not at allowlist)
    assert.strictEqual(destroyCalled, false,
      'dialog.destroy() must NOT be called for allowed caller — allowlist incorrectly rejected them');
    assert.strictEqual(queryCalled, false, 'query not called (short-circuited at fork, not at allowlist)');
  });
});

// ---------------------------------------------------------------------------
// Task 5: PII logging — phone number at DEBUG only, never at INFO
// ---------------------------------------------------------------------------

describe('allowlist rejection PII logging', () => {
  it('logs rejection at INFO without phone number, and at DEBUG with phone number', async () => {
    const loggerPath = require.resolve('../lib/logger');
    const logger = require(loggerPath);

    const infoMessages = [];
    const debugMessages = [];

    const origInfo = logger.info.bind(logger);
    const origDebug = logger.debug.bind(logger);

    logger.info = (msg, meta) => { infoMessages.push({ msg, meta }); };
    logger.debug = (msg, meta) => { debugMessages.push({ msg, meta }); };

    try {
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
        expectSession: () => { throw new Error('test: should not reach'); },
        cancelExpectation: () => {}
      };

      const mockBridge = { query: () => Promise.resolve('x'), endSession: () => Promise.resolve() };
      const mockTtsService = { generateSpeech: () => Promise.resolve('http://tts/url') };

      const { runConversationLoop } = require('../lib/conversation-loop');

      await runConversationLoop(
        mockEndpoint,
        mockDialog,
        'test-pii-call',
        {
          audioForkServer: mockAudioForkServer,
          whisperClient: {},
          claudeBridge: mockBridge,
          ttsService: mockTtsService,
          wsPort: 8080,
          deviceConfig: { extension: '9000', allowFrom: ['+15551234567'] },
          peerId: '+15550000000'
        }
      );
    } finally {
      logger.info = origInfo;
      logger.debug = origDebug;
    }

    // INFO log must contain rejection message but NOT the phone number
    const rejectionInfo = infoMessages.find(l => l.msg && l.msg.includes('rejected'));
    assert.ok(rejectionInfo, 'Must log a rejection message at INFO level');
    const infoStr = JSON.stringify(rejectionInfo);
    assert.ok(!infoStr.includes('+15550000000'), 'INFO log must NOT contain the caller phone number');

    // DEBUG log must contain the phone number
    const rejectionDebug = debugMessages.find(l => l.meta && l.meta.peerId === '+15550000000');
    assert.ok(rejectionDebug, 'Must log caller phone number at DEBUG level');
  });
});

// ---------------------------------------------------------------------------
// Task 2: device-registry preserves allowFrom from devices.json
// ---------------------------------------------------------------------------

describe('DeviceRegistry allowFrom passthrough', () => {
  const CONFIG_PATH = path.join(__dirname, '../config/devices.json');
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;

  function requireFreshRegistry() {
    const registryPath = require.resolve('../lib/device-registry');
    delete require.cache[registryPath];
    return require('../lib/device-registry');
  }

  function restoreFs() {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
  }

  it('preserves allowFrom array when loading device config', () => {
    fs.existsSync = (p) => p === CONFIG_PATH ? true : originalExistsSync(p);
    fs.readFileSync = (p, enc) => {
      if (p === CONFIG_PATH) {
        return JSON.stringify({
          '9000': {
            name: 'Morpheus',
            extension: '9000',
            accountId: 'morpheus',
            authId: 'auth-id',
            password: 'pass',
            voiceId: 'voice-id',
            allowFrom: ['+15551234567', '+15559876543']
          }
        });
      }
      return originalReadFileSync(p, enc);
    };

    const registry = requireFreshRegistry();
    const device = registry.getByExtension('9000');
    restoreFs();
    requireFreshRegistry(); // restore singleton

    assert.deepStrictEqual(
      device.allowFrom,
      ['+15551234567', '+15559876543'],
      'allowFrom array must be preserved exactly as loaded from devices.json'
    );
  });
});

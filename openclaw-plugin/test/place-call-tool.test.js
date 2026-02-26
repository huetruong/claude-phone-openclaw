'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Mocks — must be injected before index.js is loaded.
// ---------------------------------------------------------------------------

// Mock webhook-server so register() never binds a real port.
require.cache[require.resolve('../src/webhook-server')] = {
  id: require.resolve('../src/webhook-server'),
  filename: require.resolve('../src/webhook-server'),
  loaded: true,
  exports: {
    createServer: () => ({ _isMock: true }),
    startServer: async () => ({ close: (cb) => { if (cb) cb(); } }),
  },
};

// Mock outbound-client — controlled per-test via mockPlaceCallResult / lastPlaceCallArgs.
let mockPlaceCallResult = { callId: 'test-call-123', status: 'initiated' };
let lastPlaceCallArgs = null;

require.cache[require.resolve('../src/outbound-client')] = {
  id: require.resolve('../src/outbound-client'),
  filename: require.resolve('../src/outbound-client'),
  loaded: true,
  exports: {
    placeCall: async (params) => {
      lastPlaceCallArgs = params;
      return mockPlaceCallResult;
    },
  },
};

function requireIndex() {
  delete require.cache[require.resolve('../src/index')];
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  try { delete require.cache[require.resolve('../src/session-store')]; } catch { /* ignore */ }
  return require('../src/index');
}

function createMockApi(pluginConfig = {}) {
  const calls = { registerService: [], registerChannel: [], registerTool: [] };
  return {
    pluginConfig,
    config: {},
    runtime: {
      config: {
        writeConfigFile: async () => {},
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerService(serviceDef) { calls.registerService.push(serviceDef); },
    registerChannel(channelDef) { calls.registerChannel.push(channelDef); },
    registerTool(toolDef) { calls.registerTool.push(toolDef); },
    _calls: calls,
  };
}

function getPlaceCallTool(api) {
  return api._calls.registerTool.find(t => t.name === 'place_call');
}

// ---------------------------------------------------------------------------
// place_call handler — delegation to outboundClient.placeCall()
// ---------------------------------------------------------------------------

test('place_call - handler delegates to outboundClient.placeCall() with correct params', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'abc-123', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  await tool.handler({ to: '+15551234567', device: '9000', message: 'Hello world', mode: 'announce' });

  assert.ok(lastPlaceCallArgs, 'outboundClient.placeCall must be called');
  assert.strictEqual(lastPlaceCallArgs.to, '+15551234567');
  assert.strictEqual(lastPlaceCallArgs.device, '9000');
  assert.strictEqual(lastPlaceCallArgs.message, 'Hello world');
  assert.strictEqual(lastPlaceCallArgs.mode, 'announce');
});

test('place_call - handler returns { callId, status } on success', async () => {
  mockPlaceCallResult = { callId: 'call-xyz', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: '+15551234567', device: '9000', message: 'Test message' });

  assert.deepStrictEqual(result, { callId: 'call-xyz', status: 'initiated' });
});

test('place_call - handler returns { error } when voice-app unreachable', async () => {
  mockPlaceCallResult = { error: 'Voice app unreachable' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: '+15551234567', device: '9000', message: 'Test' });

  assert.ok(result.error, 'Must return error object on failure');
  assert.strictEqual(result.error, 'Voice app unreachable');
});

test('place_call - handler passes voiceAppUrl from plugin config', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'test-1', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://my-voice-app:4000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  await tool.handler({ to: '+15559876543', device: '9001', message: 'Hi there' });

  assert.strictEqual(lastPlaceCallArgs.voiceAppUrl, 'http://my-voice-app:4000');
});

test('place_call - handler works when mode is omitted (passes undefined, outboundClient handles default)', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'test-no-mode', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: '+15551234567', device: '9000', message: 'No mode specified' });

  assert.ok(lastPlaceCallArgs, 'outboundClient.placeCall must be called');
  assert.strictEqual(lastPlaceCallArgs.mode, undefined, 'mode should be undefined when not provided');
  assert.deepStrictEqual(result, { callId: 'test-no-mode', status: 'initiated' });
});

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

test('place_call - handler passes null voiceAppUrl when not configured', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { error: 'invalid voiceAppUrl: Invalid URL' };

  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] }); // no voiceAppUrl
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: '+15551234567', device: '9000', message: 'Test' });

  assert.ok(lastPlaceCallArgs, 'outboundClient.placeCall must be called even when voiceAppUrl is null');
  assert.strictEqual(lastPlaceCallArgs.voiceAppUrl, null, 'voiceAppUrl should be null when not configured');
  assert.ok(result.error, 'Must return error when voiceAppUrl is null');
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

// ---------------------------------------------------------------------------
// place_call handler — identity name resolution
// ---------------------------------------------------------------------------

test('place_call - identity name in plugin config resolves to phone number', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'id-call-1', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({
    voiceAppUrl: 'http://voice-app:3000',
    accounts: [],
    bindings: [],
    identityLinks: { operator: ['sip-voice:+15551234567'] },
  });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: 'operator', device: '9000', message: 'Task done' });

  assert.ok(lastPlaceCallArgs, 'outboundClient.placeCall must be called');
  assert.strictEqual(lastPlaceCallArgs.to, '+15551234567', 'must resolve identity to phone number');
  assert.deepStrictEqual(result, { callId: 'id-call-1', status: 'initiated' });
});

test('place_call - identity name not found returns error without calling outboundClient', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'should-not-reach', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: 'unknown', device: '9000', message: 'Test' });

  assert.strictEqual(lastPlaceCallArgs, null, 'outboundClient.placeCall must NOT be called');
  assert.ok(result.error, 'must return error');
  assert.ok(result.error.includes('unknown'), 'error must name the identity');
});

test('place_call - to as phone number (+15551234567) passes through unchanged', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'phone-call', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  await tool.handler({ to: '+15551234567', device: '9000', message: 'Hi' });

  assert.strictEqual(lastPlaceCallArgs.to, '+15551234567', 'phone number must pass through unchanged');
});

test('place_call - to as extension (9001) passes through unchanged', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'ext-call', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  await tool.handler({ to: '9001', device: '9000', message: 'Hi' });

  assert.strictEqual(lastPlaceCallArgs.to, '9001', 'extension must pass through unchanged');
});

test('place_call - identity name in session config resolves to phone number', async () => {
  lastPlaceCallArgs = null;
  mockPlaceCallResult = { callId: 'session-id-call', status: 'initiated' };

  const plugin = requireIndex();
  const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
  // Use format without '+' — matches what link_identity actually stores (strips leading +)
  api.config = { session: { identityLinks: { hue: ['sip-voice:15559876543'] } } };
  plugin.register(api);
  const tool = getPlaceCallTool(api);

  const result = await tool.handler({ to: 'hue', device: '9000', message: 'Task done' });

  assert.ok(lastPlaceCallArgs, 'outboundClient.placeCall must be called');
  assert.strictEqual(lastPlaceCallArgs.to, '15559876543', 'must resolve identity from session config');
  assert.deepStrictEqual(result, { callId: 'session-id-call', status: 'initiated' });
});

// ---------------------------------------------------------------------------
// place_call startup — identity link count logging (AC1)
// ---------------------------------------------------------------------------

test('place_call startup - logs identity link count when identityLinks configured', () => {
  const logMessages = [];
  const origLog = console.log;
  console.log = (msg) => logMessages.push(msg);

  try {
    const plugin = requireIndex();
    const api = createMockApi({
      voiceAppUrl: 'http://voice-app:3000',
      accounts: [],
      bindings: [],
      identityLinks: { operator: ['sip-voice:+15551234567'], hue: ['sip-voice:15559876543'] },
    });
    plugin.register(api);
  } finally {
    console.log = origLog;
  }

  const loadedLog = logMessages.find(m => m.includes('loaded') && m.includes('identity link'));
  assert.ok(loadedLog, 'must log identity link count on startup');
  assert.ok(loadedLog.includes('2'), 'must log the correct count (2)');
  assert.ok(!loadedLog.includes('[sip-voice] [sip-voice]'), 'must not have double [sip-voice] prefix');
});

test('place_call startup - no identity link log when identityLinks not configured', () => {
  const logMessages = [];
  const origLog = console.log;
  console.log = (msg) => logMessages.push(msg);

  try {
    const plugin = requireIndex();
    const api = createMockApi({ voiceAppUrl: 'http://voice-app:3000', accounts: [], bindings: [] });
    plugin.register(api);
  } finally {
    console.log = origLog;
  }

  const loadedLog = logMessages.find(m => m.includes('loaded') && m.includes('identity link'));
  assert.strictEqual(loadedLog, undefined, 'must not log identity link count when none configured');
});

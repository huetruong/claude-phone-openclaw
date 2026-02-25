'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Inject webhook-server mock before any index.js load so register() never binds a real port.
// requireIndex() only clears index + logger caches; this mock stays in place for all tests.
const _mockServerHandle = { close: (cb) => { if (cb) cb(); } };
require.cache[require.resolve('../src/webhook-server')] = {
  id: require.resolve('../src/webhook-server'),
  filename: require.resolve('../src/webhook-server'),
  loaded: true,
  exports: {
    createServer: () => ({ _isMock: true }),
    startServer: async () => _mockServerHandle
  }
};

function requireIndex() {
  delete require.cache[require.resolve('../src/index')];
  // Also clear logger and session-store caches to avoid cross-test state
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  try { delete require.cache[require.resolve('../src/session-store')]; } catch { /* ignore */ }
  return require('../src/index');
}

function createMockApi(pluginConfig = {}) {
  const calls = { registerService: [], registerChannel: [] };
  return {
    pluginConfig,
    config: {},  // OpenClawConfig — empty object is sufficient for unit tests
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerService(serviceDef) {
      calls.registerService.push(serviceDef);
    },
    registerChannel(channelDef) {
      calls.registerChannel.push(channelDef);
    },
    _calls: calls,
  };
}

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

test('index - exports id, name, description, and register', () => {
  const plugin = requireIndex();
  assert.strictEqual(typeof plugin.id, 'string', 'Must export id string');
  assert.strictEqual(typeof plugin.name, 'string', 'Must export name string');
  assert.strictEqual(typeof plugin.description, 'string', 'Must export description string');
  assert.strictEqual(typeof plugin.register, 'function', 'Must export register function');
});

test('index - id is openclaw-sip-voice', () => {
  const plugin = requireIndex();
  assert.strictEqual(plugin.id, 'openclaw-sip-voice');
});

test('index - does NOT export activate or getConfig (old API removed)', () => {
  const plugin = requireIndex();
  assert.strictEqual(typeof plugin.activate, 'undefined', 'activate must not be exported');
  assert.strictEqual(typeof plugin.getConfig, 'undefined', 'getConfig must not be exported');
});

// ---------------------------------------------------------------------------
// register() behaviour
// ---------------------------------------------------------------------------

test('index - register() is synchronous (returns undefined, not a Promise)', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  const result = plugin.register(api);
  assert.strictEqual(result, undefined, 'register() must return undefined (synchronous)');
});

test('index - register() reads api.pluginConfig (not api.getConfig)', () => {
  const plugin = requireIndex();
  let pluginConfigAccessed = false;
  const api = createMockApi({ accounts: [], bindings: [] });
  Object.defineProperty(api, 'pluginConfig', {
    get() { pluginConfigAccessed = true; return { accounts: [], bindings: [] }; },
    configurable: true,
  });
  plugin.register(api);
  assert.ok(pluginConfigAccessed, 'register() must read api.pluginConfig');
});

test('index - register() calls api.registerService() once', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  assert.strictEqual(api._calls.registerService.length, 1, 'registerService must be called once');
});

test('index - register() does NOT call api.registerChannel()', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  assert.strictEqual(api._calls.registerChannel.length, 0, 'registerChannel must NOT be called');
});

test('index - registered service has id sip-voice-webhook', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const service = api._calls.registerService[0];
  assert.strictEqual(service.id, 'sip-voice-webhook');
});

test('index - registered service has async start and stop functions', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const service = api._calls.registerService[0];
  assert.strictEqual(typeof service.start, 'function', 'service must have start()');
  assert.strictEqual(typeof service.stop, 'function', 'service must have stop()');
});

test('index - service.start() calls createServer and startServer', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ apiKey: 'test-key', accounts: [], bindings: [] });
  plugin.register(api);
  const service = api._calls.registerService[0];
  // Should not throw — webhook-server mock returns a handle
  await assert.doesNotReject(service.start(), 'service.start() must not throw');
});

test('index - service.stop() is safe to call before start()', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const service = api._calls.registerService[0];
  await assert.doesNotReject(service.stop(), 'service.stop() before start() must not throw');
});

test('index - register() handles missing accounts/bindings gracefully', () => {
  const plugin = requireIndex();
  const api = createMockApi({}); // no accounts or bindings
  assert.doesNotThrow(() => plugin.register(api), 'register() must not throw with empty config');
});

test('index - register() handles undefined pluginConfig gracefully', () => {
  const plugin = requireIndex();
  const api = createMockApi(undefined);
  assert.doesNotThrow(() => plugin.register(api), 'register() must not throw with undefined pluginConfig');
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

test('index - start() logs loaded N account bindings', async () => {
  const plugin = requireIndex();
  const api = createMockApi({
    accounts: [{ id: 'morpheus' }, { id: 'dewey' }],
    bindings: [
      { accountId: 'morpheus', agentId: 'morpheus' },
      { accountId: 'dewey', agentId: 'dewey' },
    ],
  });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    plugin.register(api);
    await api._calls.registerService[0].start();
  } finally {
    console.log = origLog;
  }

  const bindingsLog = logLines.find(l => l.includes('loaded') && l.includes('account bindings'));
  assert.ok(bindingsLog, 'start() must log "loaded N account bindings"');
  assert.ok(bindingsLog.includes('[sip-voice]'), 'Log must include [sip-voice] prefix');
  assert.ok(bindingsLog.includes('loaded 2 account bindings'), 'Must include exact count');
});

test('index - start() logs "loaded 0 account bindings" when no bindings configured', async () => {
  const plugin = requireIndex();
  const api = createMockApi({});

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    plugin.register(api);
    await api._calls.registerService[0].start();
  } finally {
    console.log = origLog;
  }

  const bindingsLog = logLines.find(l => l.includes('loaded') && l.includes('account bindings'));
  assert.ok(bindingsLog, 'start() must log binding count even when zero');
  assert.ok(bindingsLog.includes('loaded 0 account bindings'), 'Must log "loaded 0 account bindings"');
});

test('index - start() includes account and binding counts in log data', async () => {
  const plugin = requireIndex();
  const api = createMockApi({
    accounts: [{ id: 'morpheus' }, { id: 'dewey' }],
    bindings: [{ accountId: 'morpheus', agentId: 'morpheus' }],
  });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    plugin.register(api);
    await api._calls.registerService[0].start();
  } finally {
    console.log = origLog;
  }

  const bindingsLog = logLines.find(l => l.includes('loaded') && l.includes('account bindings'));
  assert.ok(bindingsLog.includes('"accounts":2'), 'Log must include accounts count');
  assert.ok(bindingsLog.includes('"bindings":1'), 'Log must include bindings count');
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test('index - register() propagates if api.registerService throws', () => {
  const plugin = requireIndex();
  const api = createMockApi({});
  api.registerService = () => { throw new Error('service conflict'); };

  assert.throws(
    () => plugin.register(api),
    /service conflict/,
    'register() must propagate errors from registerService'
  );
});

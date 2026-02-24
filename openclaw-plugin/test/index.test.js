'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Inject webhook-server mock before any index.js load so activate() never binds a real port.
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

function createMockApi(config = {}) {
  const calls = { registerChannel: [], getConfig: 0 };
  return {
    registerChannel(channelDef) {
      calls.registerChannel.push(channelDef);
    },
    getConfig() {
      calls.getConfig++;
      return config;
    },
    _calls: calls
  };
}

test('index - activate() calls api.registerChannel with id sip-voice', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  await plugin.activate(api);
  assert.strictEqual(api._calls.registerChannel.length, 1,
    'registerChannel must be called once');
  assert.strictEqual(api._calls.registerChannel[0].id, 'sip-voice',
    'Channel id must be "sip-voice"');
});

test('index - activate() includes name and description in channel registration', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  await plugin.activate(api);
  const reg = api._calls.registerChannel[0];
  assert.ok(reg.name, 'Channel must have a name');
  assert.ok(reg.description, 'Channel must have a description');
});

test('index - activate() calls api.getConfig()', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  await plugin.activate(api);
  assert.ok(api._calls.getConfig > 0, 'getConfig() must be called during activation');
});

test('index - getConfig() returns empty object before activate', () => {
  const plugin = requireIndex();
  const config = plugin.getConfig();
  assert.deepStrictEqual(config, {}, 'getConfig() must return {} before activate');
});

test('index - getConfig() returns api config after activate', async () => {
  const plugin = requireIndex();
  const expected = { accounts: [{ id: 'morpheus' }], bindings: [{ accountId: 'morpheus', agentId: 'morpheus' }] };
  const api = createMockApi(expected);
  await plugin.activate(api);
  const config = plugin.getConfig();
  assert.deepStrictEqual(config, expected, 'getConfig() must return config from api.getConfig()');
});

test('index - activate() handles missing accounts/bindings gracefully', async () => {
  const plugin = requireIndex();
  const api = createMockApi({}); // no accounts or bindings in config
  await assert.doesNotReject(plugin.activate(api),
    'activate() must not throw when accounts/bindings are absent');
});

test('index - exports activate and getConfig functions', () => {
  const plugin = requireIndex();
  assert.strictEqual(typeof plugin.activate, 'function', 'Must export activate function');
  assert.strictEqual(typeof plugin.getConfig, 'function', 'Must export getConfig function');
});

// H1: Verify activate() actually calls logger.info with 'channel registered' (AC #2)
test('index - activate() logs [sip-voice] channel registered at INFO level', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    await plugin.activate(api);
  } finally {
    console.log = origLog;
  }

  assert.strictEqual(logLines.length, 2, 'activate() must emit exactly two INFO log lines');
  assert.ok(logLines[1].includes('[sip-voice]'), 'Log must include [sip-voice] prefix');
  assert.ok(logLines[1].includes('channel registered'), 'Log must include "channel registered"');
  assert.ok(logLines[1].includes('INFO'), 'Log must be at INFO level');
});

// H1: Verify account/binding counts are included in the log
test('index - activate() includes account and binding counts in log', async () => {
  const plugin = requireIndex();
  const api = createMockApi({
    accounts: [{ id: 'morpheus' }, { id: 'cephanie' }],
    bindings: [{ accountId: 'morpheus', agentId: 'morpheus' }]
  });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    await plugin.activate(api);
  } finally {
    console.log = origLog;
  }

  assert.ok(logLines[1].includes('"accounts":2'), 'Log must include accounts count');
  assert.ok(logLines[1].includes('"bindings":1'), 'Log must include bindings count');
});

test('index - activate() logs [sip-voice] loaded N account bindings', async () => {
  const plugin = requireIndex();
  const api = createMockApi({
    accounts: [{ id: 'morpheus' }, { id: 'cephanie' }],
    bindings: [
      { accountId: 'morpheus', agentId: 'morpheus' },
      { accountId: 'cephanie', agentId: 'cephanie' }
    ]
  });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    await plugin.activate(api);
  } finally {
    console.log = origLog;
  }

  const bindingsLog = logLines.find((line) => line.includes('loaded') && line.includes('account bindings'));
  assert.ok(bindingsLog, 'activate() must log "loaded N account bindings"');
  assert.ok(bindingsLog.includes('[sip-voice]'), 'Log must include [sip-voice] prefix');
  assert.ok(bindingsLog.includes('loaded 2 account bindings'), 'Log must include exact text "loaded 2 account bindings"');
});

test('index - activate() logs "loaded 0 account bindings" when no bindings configured', async () => {
  const plugin = requireIndex();
  const api = createMockApi({});

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));
  try {
    await plugin.activate(api);
  } finally {
    console.log = origLog;
  }

  const bindingsLog = logLines.find((line) => line.includes('loaded') && line.includes('account bindings'));
  assert.ok(bindingsLog, 'activate() must log "loaded N account bindings" even with no bindings');
  assert.ok(bindingsLog.includes('loaded 0 account bindings'), 'Log must include exact text "loaded 0 account bindings"');
});

// M3: Verify activate() rethrows registration errors (after logging them)
test('index - activate() rethrows if registerChannel throws', async () => {
  const plugin = requireIndex();
  const api = createMockApi({});
  api.registerChannel = () => { throw new Error('duplicate channel id'); };

  await assert.rejects(
    plugin.activate(api),
    /duplicate channel id/,
    'activate() must rethrow errors from registerChannel'
  );
});

// M2: Verify getConfig() returns a copy, not the live internal reference
test('index - getConfig() returns a shallow copy, not the internal reference', async () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [{ id: 'morpheus' }] });
  await plugin.activate(api);

  const config = plugin.getConfig();
  config.accounts = ['mutated'];

  const config2 = plugin.getConfig();
  assert.deepStrictEqual(config2.accounts, [{ id: 'morpheus' }],
    'Mutating getConfig() result must not affect internal pluginConfig');
});

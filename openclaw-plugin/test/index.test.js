'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function requireIndex() {
  delete require.cache[require.resolve('../src/index')];
  // Also clear logger cache to avoid cross-test state
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
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

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
  const calls = { registerService: [], registerChannel: [], registerTool: [] };
  return {
    pluginConfig,
    config: {},  // OpenClawConfig — empty object is sufficient for unit tests
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
    registerService(serviceDef) {
      calls.registerService.push(serviceDef);
    },
    registerChannel(channelDef) {
      calls.registerChannel.push(channelDef);
    },
    registerTool(toolDef) {
      calls.registerTool.push(toolDef);
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
// Lifecycle: stop() after start() (Story 4.4 / AC1 / Task 5.2)
// ---------------------------------------------------------------------------

test('index - service.stop() calls server.close() after start() and is idempotent', async () => {
  let closeCallCount = 0;
  const origClose = _mockServerHandle.close;
  _mockServerHandle.close = (cb) => {
    closeCallCount++;
    if (cb) cb();
  };

  try {
    const plugin = requireIndex();
    const api = createMockApi({ apiKey: 'test-key', accounts: [], bindings: [] });
    plugin.register(api);
    const service = api._calls.registerService[0];

    await service.start();
    assert.strictEqual(closeCallCount, 0, 'close() must not be called before stop()');

    await service.stop();
    assert.strictEqual(closeCallCount, 1, 'close() must be called exactly once on first stop()');

    // Second stop() must be a no-op (_server was nulled)
    await service.stop();
    assert.strictEqual(closeCallCount, 1, 'close() must not be called again on second stop()');
  } finally {
    _mockServerHandle.close = origClose;
  }
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

// ---------------------------------------------------------------------------
// link_identity tool registration (Story 5.2)
// ---------------------------------------------------------------------------

test('index - register() calls api.registerTool() with link_identity', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const toolNames = api._calls.registerTool.map(t => t.name);
  assert.ok(toolNames.includes('link_identity'), 'Must register link_identity tool');
});

test('index - link_identity tool has a schema with required name and peerId', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const tool = api._calls.registerTool.find(t => t.name === 'link_identity');
  assert.ok(tool, 'link_identity tool must be registered');
  assert.ok(tool.schema, 'tool must have a schema');
  assert.ok(Array.isArray(tool.schema.required), 'schema.required must be an array');
  assert.ok(tool.schema.required.includes('name'), 'schema must require name');
  assert.ok(tool.schema.required.includes('peerId'), 'schema must require peerId');
});

test('index - link_identity tool has an async handler function', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const tool = api._calls.registerTool.find(t => t.name === 'link_identity');
  assert.ok(tool, 'link_identity tool must be registered');
  assert.strictEqual(typeof tool.handler, 'function', 'tool must have a handler function');
});

test('index - register() still calls api.registerService() exactly once alongside registerTool', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  assert.strictEqual(api._calls.registerService.length, 1, 'registerService must still be called once');
  assert.strictEqual(api._calls.registerTool.length, 2, 'registerTool must be called twice (link_identity + place_call)');
});

// ---------------------------------------------------------------------------
// place_call tool registration (Story 5.4)
// ---------------------------------------------------------------------------

test('index - register() calls api.registerTool() with place_call', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const toolNames = api._calls.registerTool.map(t => t.name);
  assert.ok(toolNames.includes('place_call'), 'Must register place_call tool');
});

test('index - place_call tool has schema with required to, device, and message', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const tool = api._calls.registerTool.find(t => t.name === 'place_call');
  assert.ok(tool, 'place_call tool must be registered');
  assert.ok(tool.schema, 'tool must have a schema');
  assert.ok(Array.isArray(tool.schema.required), 'schema.required must be an array');
  assert.ok(tool.schema.required.includes('to'), 'schema must require to');
  assert.ok(tool.schema.required.includes('device'), 'schema must require device');
  assert.ok(tool.schema.required.includes('message'), 'schema must require message');
});

test('index - place_call tool has an async handler function', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  const tool = api._calls.registerTool.find(t => t.name === 'place_call');
  assert.ok(tool, 'place_call tool must be registered');
  assert.strictEqual(typeof tool.handler, 'function', 'tool must have a handler function');
});

test('index - register() calls api.registerTool() exactly 2 times (link_identity + place_call)', () => {
  const plugin = requireIndex();
  const api = createMockApi({ accounts: [], bindings: [] });
  plugin.register(api);
  assert.strictEqual(api._calls.registerTool.length, 2, 'registerTool must be called exactly twice');
  const toolNames = api._calls.registerTool.map(t => t.name);
  assert.ok(toolNames.includes('link_identity'), 'Must include link_identity');
  assert.ok(toolNames.includes('place_call'), 'Must include place_call');
});

// ---------------------------------------------------------------------------
// resolveSessionSuffix unit tests (Story 5.5, Task 3)
// ---------------------------------------------------------------------------

test('index - resolveSessionSuffix: enrolled identity returns identity name', () => {
  const plugin = requireIndex();
  const result = plugin._resolveSessionSuffix({ identity: 'hue', isFirstCall: false }, '+15551234567', 'call-uuid-123');
  assert.strictEqual(result, 'hue');
});

test('index - resolveSessionSuffix: unenrolled caller with peerId returns normalized phone', () => {
  const plugin = requireIndex();
  const result = plugin._resolveSessionSuffix({ isFirstCall: true }, '+15551234567', 'call-uuid-123');
  assert.strictEqual(result, '15551234567');
});

test('index - resolveSessionSuffix: peerId with + prefix is stripped', () => {
  const plugin = requireIndex();
  const result = plugin._resolveSessionSuffix(null, '+15551234567', 'call-uuid-123');
  assert.strictEqual(result, '15551234567');
});

test('index - resolveSessionSuffix: no peerId and no identity returns callId', () => {
  const plugin = requireIndex();
  const result = plugin._resolveSessionSuffix(null, null, 'call-uuid-123');
  assert.strictEqual(result, 'call-uuid-123');
});

test('index - resolveSessionSuffix: identity takes precedence over peerId when both present', () => {
  const plugin = requireIndex();
  const result = plugin._resolveSessionSuffix({ identity: 'hue', isFirstCall: false }, '+15551234567', 'call-uuid-123');
  assert.strictEqual(result, 'hue');
});

// ---------------------------------------------------------------------------
// queryAgent identity-keyed session integration tests (Story 5.5, Task 4)
// ---------------------------------------------------------------------------

test('index - queryAgent passes resolveSessionSuffix result to createServer', async () => {
  // Capture the queryAgent function passed to createServer and verify it exists.
  // The unit tests for resolveSessionSuffix prove the suffix logic; this test
  // verifies the wiring — that queryAgent is constructed and passed through.
  let capturedQueryAgent = null;
  require.cache[require.resolve('../src/webhook-server')] = {
    id: require.resolve('../src/webhook-server'),
    filename: require.resolve('../src/webhook-server'),
    loaded: true,
    exports: {
      createServer: (opts) => { capturedQueryAgent = opts.queryAgent; return { _isMock: true }; },
      startServer: async () => _mockServerHandle,
    }
  };

  const plugin2 = requireIndex();
  const api2 = createMockApi({ accounts: [], bindings: [], apiKey: 'test' });
  plugin2.register(api2);
  const service = api2._calls.registerService[0];
  try {
    await service.start();

    assert.ok(capturedQueryAgent, 'queryAgent must be passed to createServer');
    assert.strictEqual(typeof capturedQueryAgent, 'function', 'queryAgent must be a function');
  } finally {
    await service.stop();

    // Restore original webhook-server mock
    require.cache[require.resolve('../src/webhook-server')] = {
      id: require.resolve('../src/webhook-server'),
      filename: require.resolve('../src/webhook-server'),
      loaded: true,
      exports: {
        createServer: () => ({ _isMock: true }),
        startServer: async () => _mockServerHandle,
      }
    };
  }
});

test('index - resolveSessionSuffix: covers all three AC variants including edge cases (null, undefined, empty peerId)', () => {
  const plugin = requireIndex();
  const fn = plugin._resolveSessionSuffix;

  // AC #1: enrolled identity
  assert.strictEqual(fn({ identity: 'hue', isFirstCall: false }, '+15551234567', 'uuid-1'), 'hue');

  // AC #2: unenrolled caller with phone
  assert.strictEqual(fn({ isFirstCall: true }, '+15551234567', 'uuid-2'), '15551234567');

  // AC #3: no peerId (extension-only call) — null, undefined, and empty string all fall back to callId
  assert.strictEqual(fn(null, null, 'uuid-3'), 'uuid-3');
  assert.strictEqual(fn(undefined, undefined, 'uuid-4'), 'uuid-4');
  assert.strictEqual(fn({}, '', 'uuid-5'), 'uuid-5');
});

// ---------------------------------------------------------------------------
// resolveSessionSuffix edge cases (M2 / M3 guard coverage)
// ---------------------------------------------------------------------------

test('index - resolveSessionSuffix: peerId of only "+" falls back to callId after stripping', () => {
  const plugin = requireIndex();
  // '+' normalizes to '' which is falsy — must fall through to callId
  const result = plugin._resolveSessionSuffix(null, '+', 'call-uuid-123');
  assert.strictEqual(result, 'call-uuid-123', '"+" peerId must fall back to callId, not empty string');
});

test('index - resolveSessionSuffix: empty string identity falls through to peerId', () => {
  const plugin = requireIndex();
  // identity='' is falsy — must be treated as no identity, fall through to peerId
  const result = plugin._resolveSessionSuffix({ identity: '', isFirstCall: false }, '+15551234567', 'call-uuid-123');
  assert.strictEqual(result, '15551234567', 'Empty string identity must be ignored, fall through to peerId');
});

// ---------------------------------------------------------------------------
// queryAgent direct integration tests (Story 5.5, Tasks 4.1-4.5)
// These tests inject a mock extensionAPI via _setExtensionAPIForTest to invoke
// queryAgent end-to-end and assert exactly what runEmbeddedPiAgent receives.
// ---------------------------------------------------------------------------

/**
 * Sets up a queryAgent test environment:
 * - Injects a capturing webhook-server mock to extract the queryAgent closure
 * - Injects a mock extensionAPI to avoid ESM dynamic import of openclaw internals
 * - Returns { capturedQueryAgent, runCalls, service, cleanup }
 */
async function setupQueryAgentEnv(opts = {}) {
  const runCalls = [];
  let capturedQueryAgent = null;

  require.cache[require.resolve('../src/webhook-server')] = {
    id: require.resolve('../src/webhook-server'),
    filename: require.resolve('../src/webhook-server'),
    loaded: true,
    exports: {
      createServer: (serverOpts) => { capturedQueryAgent = serverOpts.queryAgent; return { _isMock: true }; },
      startServer: async () => _mockServerHandle,
    }
  };

  const mockExt = {
    resolveStorePath: () => '/fake/store/sessions.db',
    resolveAgentDir: (_cfg, agentId) => `/fake/agents/${agentId}`,
    resolveAgentWorkspaceDir: (_cfg, agentId) => `/fake/agents/${agentId}/workspace`,
    ensureAgentWorkspace: async () => {},
    runEmbeddedPiAgent: async (runOpts) => { runCalls.push(runOpts); return { payloads: [{ text: 'ok', isError: false }] }; },
  };

  const plugin = requireIndex();
  plugin._setExtensionAPIForTest(mockExt);
  const pluginConfig = { accounts: [], bindings: [], apiKey: 'test', ...(opts.pluginConfig || {}) };
  const api = createMockApi(pluginConfig);
  plugin.register(api);
  const service = api._calls.registerService[0];
  await service.start();

  const cleanup = async () => {
    await service.stop();
    require.cache[require.resolve('../src/webhook-server')] = {
      id: require.resolve('../src/webhook-server'),
      filename: require.resolve('../src/webhook-server'),
      loaded: true,
      exports: {
        createServer: () => ({ _isMock: true }),
        startServer: async () => _mockServerHandle,
      }
    };
  };

  return { capturedQueryAgent, runCalls, service, cleanup };
}

test('index - queryAgent (Task 4.1): enrolled identity produces sip-voice/morpheus-hue.jsonl session file', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-1', 'hello', '+15551234567', { identity: 'hue', isFirstCall: false });
    assert.strictEqual(runCalls.length, 1, 'runEmbeddedPiAgent must be called once');
    assert.ok(
      runCalls[0].sessionFile.endsWith(`morpheus-hue.jsonl`),
      `sessionFile must end with morpheus-hue.jsonl, got: ${runCalls[0].sessionFile}`
    );
  } finally {
    await cleanup();
  }
});

test('index - queryAgent (Task 4.2): unenrolled caller produces sip-voice/morpheus-15551234567.jsonl session file', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-2', 'hello', '+15551234567', { isFirstCall: true, identity: null });
    assert.ok(
      runCalls[0].sessionFile.endsWith('morpheus-15551234567.jsonl'),
      `sessionFile must end with morpheus-15551234567.jsonl, got: ${runCalls[0].sessionFile}`
    );
  } finally {
    await cleanup();
  }
});

test('index - queryAgent (Task 4.3): no peerId falls back to callId-keyed session file', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-3', 'hello', null, null);
    assert.ok(
      runCalls[0].sessionFile.endsWith('morpheus-call-uuid-3.jsonl'),
      `sessionFile must end with morpheus-call-uuid-3.jsonl, got: ${runCalls[0].sessionFile}`
    );
  } finally {
    await cleanup();
  }
});

test('index - queryAgent (Task 4.4): enrolled identity produces correct sessionKey and sessionId', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-4', 'hello', '+15551234567', { identity: 'hue', isFirstCall: false });
    const opts = runCalls[0];
    assert.strictEqual(opts.sessionKey, 'sip-voice:morpheus:hue', `sessionKey must be sip-voice:morpheus:hue, got: ${opts.sessionKey}`);
    assert.strictEqual(opts.sessionId, 'hue', `sessionId passed to runEmbeddedPiAgent must be 'hue', got: ${opts.sessionId}`);
  } finally {
    await cleanup();
  }
});

test('index - queryAgent (Task 4.5): runId uses callId not identity suffix', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-5', 'hello', '+15551234567', { identity: 'hue', isFirstCall: false });
    const { runId } = runCalls[0];
    assert.ok(runId.startsWith('sip:call-uuid-5:'), `runId must start with 'sip:call-uuid-5:', got: ${runId}`);
    assert.ok(!runId.includes(':hue:'), `runId must NOT contain identity suffix ':hue:', got: ${runId}`);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// SKILL.md manifest verification (Story 5.4, Task 5.3)
// ---------------------------------------------------------------------------

test('manifest - openclaw.plugin.json contains skills field pointing to ./skills', () => {
  const manifest = require('../openclaw.plugin.json');
  assert.ok(manifest.skills, 'manifest must have a skills field');
  assert.ok(Array.isArray(manifest.skills), 'skills field must be an array');
  assert.ok(manifest.skills.includes('./skills'), 'skills must include ./skills');
});

// ---------------------------------------------------------------------------
// Channel-enriched caller context integration tests (Story 5.7, Tasks 5.1-5.3)
// ---------------------------------------------------------------------------

test('index - queryAgent (Task 5.1): known caller with channels includes textChannels in enriched prompt', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv({
    pluginConfig: { identityLinks: { hue: ['sip-voice:15551234567', 'discord:987654321'] } },
  });
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-c1', 'hello', '+15551234567', { identity: 'hue', isFirstCall: false });
    assert.strictEqual(runCalls.length, 1, 'runEmbeddedPiAgent must be called once');
    const prompt = runCalls[0].prompt;
    const expectedCtx = '[CALLER CONTEXT: Known caller, identity="hue", textChannels=["discord:987654321"]]';
    assert.ok(
      prompt.startsWith(expectedCtx),
      `enriched prompt must start with exact CALLER CONTEXT line, got: ${prompt}`
    );
  } finally {
    await cleanup();
  }
});

test('index - queryAgent (Task 5.2): known caller with NO channels includes textChannels=none in enriched prompt', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv({
    pluginConfig: { identityLinks: { hue: ['sip-voice:15551234567'] } },
  });
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-c2', 'hello', '+15551234567', { identity: 'hue', isFirstCall: false });
    const prompt = runCalls[0].prompt;
    const expectedCtx = '[CALLER CONTEXT: Known caller, identity="hue", textChannels=none]';
    assert.ok(
      prompt.startsWith(expectedCtx),
      `enriched prompt must start with exact CALLER CONTEXT line, got: ${prompt}`
    );
  } finally {
    await cleanup();
  }
});

test('index - queryAgent (Task 5.3): first-time caller does NOT include textChannels in enriched prompt', async () => {
  const { capturedQueryAgent, runCalls, cleanup } = await setupQueryAgentEnv();
  try {
    await capturedQueryAgent('morpheus', 'call-uuid-c3', 'hello', '+15551234567', { isFirstCall: true, identity: null });
    const prompt = runCalls[0].prompt;
    const expectedCtx = '[CALLER CONTEXT: First-time caller, no identity on file, phone="+15551234567"]';
    assert.ok(
      prompt.startsWith(expectedCtx),
      `first-time caller enriched prompt must start with exact CALLER CONTEXT line, got: ${prompt}`
    );
    assert.ok(
      !prompt.includes('textChannels'),
      `first-time caller enriched prompt must NOT include textChannels, got: ${prompt}`
    );
  } finally {
    await cleanup();
  }
});

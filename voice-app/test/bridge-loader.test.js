'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const LOADER_PATH = require.resolve('../lib/bridge-loader');
const OPENCLAW_PATH = require.resolve('../lib/openclaw-bridge');
const CLAUDE_PATH = require.resolve('../lib/claude-bridge');

function requireFreshLoader() {
  delete require.cache[LOADER_PATH];
  delete require.cache[OPENCLAW_PATH];
  delete require.cache[CLAUDE_PATH];
  return require('../lib/bridge-loader');
}

// ---------------------------------------------------------------------------
// bridge-loader tests (Task 5)
// ---------------------------------------------------------------------------

describe('bridge-loader', () => {
  const savedBridgeType = process.env.BRIDGE_TYPE;

  after(() => {
    // Restore original env var state
    if (savedBridgeType === undefined) {
      delete process.env.BRIDGE_TYPE;
    } else {
      process.env.BRIDGE_TYPE = savedBridgeType;
    }
    // Restore module caches
    delete require.cache[LOADER_PATH];
    delete require.cache[OPENCLAW_PATH];
    delete require.cache[CLAUDE_PATH];
  });

  it('loads openclaw-bridge when BRIDGE_TYPE=openclaw', () => {
    process.env.BRIDGE_TYPE = 'openclaw';
    const { loadBridge } = requireFreshLoader();
    const bridge = loadBridge();
    // After loadBridge() ran, openclaw-bridge is cached — verify same object identity
    const openclaw = require('../lib/openclaw-bridge');
    assert.strictEqual(bridge, openclaw, 'Expected openclaw-bridge module');
  });

  it('loads claude-bridge when BRIDGE_TYPE=claude', () => {
    process.env.BRIDGE_TYPE = 'claude';
    const { loadBridge } = requireFreshLoader();
    const bridge = loadBridge();
    const claudeBridge = require('../lib/claude-bridge');
    assert.strictEqual(bridge, claudeBridge, 'Expected claude-bridge module');
  });

  it('defaults to claude-bridge when BRIDGE_TYPE is unset', () => {
    delete process.env.BRIDGE_TYPE;
    const { loadBridge } = requireFreshLoader();
    const bridge = loadBridge();
    const claudeBridge = require('../lib/claude-bridge');
    assert.strictEqual(bridge, claudeBridge, 'Expected claude-bridge as default');
  });

  it('throws a clear error on invalid BRIDGE_TYPE', () => {
    process.env.BRIDGE_TYPE = 'unknown-ai';
    const { loadBridge } = requireFreshLoader();
    assert.throws(
      () => loadBridge(),
      (err) => {
        assert.ok(err.message.includes('[BRIDGE] Invalid BRIDGE_TYPE'), 'Error should mention [BRIDGE] Invalid BRIDGE_TYPE');
        assert.ok(err.message.includes('unknown-ai'), 'Error should include the invalid value');
        return true;
      }
    );
  });
});

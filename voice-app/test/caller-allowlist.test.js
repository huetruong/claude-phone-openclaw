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

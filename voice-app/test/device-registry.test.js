'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '../config/devices.json');

// Save originals
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;

function setupFsMock(exists, devicesObj) {
  fs.existsSync = (p) => {
    if (p === CONFIG_PATH) return exists;
    return originalExistsSync(p);
  };
  fs.readFileSync = (p, enc) => {
    if (p === CONFIG_PATH) return JSON.stringify(devicesObj);
    return originalReadFileSync(p, enc);
  };
}

function restoreFs() {
  fs.existsSync = originalExistsSync;
  fs.readFileSync = originalReadFileSync;
}

function requireFreshRegistry() {
  const registryPath = require.resolve('../lib/device-registry');
  delete require.cache[registryPath];
  return require('../lib/device-registry');
}

after(() => {
  restoreFs();
  // Re-require with real fs to restore singleton
  requireFreshRegistry();
});

describe('DeviceRegistry', () => {
  describe('accountId loading', () => {
    it('preserves accountId when device has it', () => {
      setupFsMock(true, {
        '9000': {
          name: 'Morpheus',
          extension: '9000',
          accountId: 'morpheus',
          authId: 'auth-id',
          password: 'pass',
          voiceId: 'voice-id',
          prompt: 'You are Morpheus.'
        }
      });

      const registry = requireFreshRegistry();
      const device = registry.getByExtension('9000');
      restoreFs();

      assert.strictEqual(device.accountId, 'morpheus');
    });

    it('falls back to name when device is missing accountId', () => {
      setupFsMock(true, {
        '9000': {
          name: 'Morpheus',
          extension: '9000',
          authId: 'auth-id',
          password: 'pass',
          voiceId: 'voice-id',
          prompt: 'You are Morpheus.'
        }
      });

      const registry = requireFreshRegistry();
      const device = registry.getByExtension('9000');
      restoreFs();

      assert.strictEqual(device.accountId, 'Morpheus');
    });

    it('logs a warning when falling back to name', () => {
      setupFsMock(true, {
        '9000': {
          name: 'Morpheus',
          extension: '9000',
          authId: 'auth-id',
          password: 'pass',
          voiceId: 'voice-id',
          prompt: 'You are Morpheus.'
        }
      });

      // Capture logger.warn calls
      const loggerPath = require.resolve('../lib/logger');
      const logger = require(loggerPath);
      const warnMessages = [];
      const originalWarn = logger.warn.bind(logger);
      logger.warn = (msg, ...args) => {
        warnMessages.push(msg);
        return originalWarn(msg, ...args);
      };

      requireFreshRegistry();

      restoreFs();
      logger.warn = originalWarn;

      assert.ok(
        warnMessages.some(m => typeof m === 'string' && m.toLowerCase().includes('accountid')),
        `Expected a warning about missing accountId, got: ${JSON.stringify(warnMessages)}`
      );
    });

    it('MORPHEUS_DEFAULT has accountId set', () => {
      // Config file missing — will use MORPHEUS_DEFAULT
      setupFsMock(false, {});

      const registry = requireFreshRegistry();
      const defaultDevice = registry.getDefault();
      restoreFs();

      assert.ok(defaultDevice.accountId, 'MORPHEUS_DEFAULT should have accountId set');
    });

    it('extension lookup returns device with accountId when config file is missing', () => {
      // When devices.json is absent the registry falls back to MORPHEUS_DEFAULT
      // keyed under extension '9000' — verify accountId survives that path
      setupFsMock(false, {});

      const registry = requireFreshRegistry();
      const device = registry.getByExtension('9000');
      restoreFs();

      assert.ok(device, 'should return a device for extension 9000 even without config file');
      assert.ok(device.accountId, 'fallback device should have accountId set');
    });
  });
});

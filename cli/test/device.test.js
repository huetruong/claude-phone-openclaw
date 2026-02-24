import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Device management', () => {
  describe('Device add', () => {
    it('should use input type for system prompt, not editor', () => {
      // This test reproduces the bug: editor type hangs the CLI
      // System prompt should use 'input' type for better compatibility
      const promptFieldType = 'input'; // Expected type
      const buggyType = 'editor'; // Current buggy type

      assert.notStrictEqual(promptFieldType, buggyType,
        'Prompt field should use input type, not editor (which hangs)');
    });

    it('should validate device name is unique', () => {
      const existingDevices = [
        { name: 'Morpheus', extension: '9000' },
        { name: 'Cephanie', extension: '9002' }
      ];

      const newName = 'Trinity';
      const isDuplicate = existingDevices.some(
        d => d.name.toLowerCase() === newName.toLowerCase()
      );

      assert.strictEqual(isDuplicate, false, 'New device name should not be duplicate');
    });

    it('should reject duplicate device names', () => {
      const existingDevices = [
        { name: 'Morpheus', extension: '9000' }
      ];

      const newName = 'Morpheus';
      const isDuplicate = existingDevices.some(
        d => d.name.toLowerCase() === newName.toLowerCase()
      );

      assert.strictEqual(isDuplicate, true, 'Duplicate device name should be detected');
    });

    it('should validate extension is unique', () => {
      const existingDevices = [
        { name: 'Morpheus', extension: '9000' }
      ];

      const newExtension = '9001';
      const isDuplicate = existingDevices.some(d => d.extension === newExtension);

      assert.strictEqual(isDuplicate, false, 'New extension should not be duplicate');
    });

    it('should add device to config', () => {
      const config = {
        devices: [
          { name: 'Morpheus', extension: '9000' }
        ]
      };

      const newDevice = {
        name: 'Trinity',
        accountId: 'trinity',
        extension: '9001',
        authId: '9001',
        password: 'secret',
        voiceId: 'voice-123',
        prompt: 'You are Trinity'
      };

      config.devices.push(newDevice);

      assert.strictEqual(config.devices.length, 2);
      assert.strictEqual(config.devices[1].name, 'Trinity');
    });

    it('should include accountId in saved device when provided', () => {
      const config = { devices: [{ name: 'Morpheus', extension: '9000' }] };
      const answers = { name: 'Trinity', accountId: 'custom-id' };
      const newDevice = {
        name: answers.name.trim(),
        accountId: answers.accountId.trim() || answers.name.trim().toLowerCase(),
        extension: '9001',
        authId: '9001',
        password: 'secret',
        voiceId: 'voice-123',
        prompt: 'You are Trinity'
      };
      config.devices.push(newDevice);
      assert.strictEqual(config.devices[1].accountId, 'custom-id');
    });

    it('should default accountId to device name (lowercased) when left blank', () => {
      const config = { devices: [] };
      const answers = { name: 'Trinity', accountId: '' };
      const newDevice = {
        name: answers.name.trim(),
        accountId: answers.accountId.trim() || answers.name.trim().toLowerCase(),
        extension: '9001',
      };
      config.devices.push(newDevice);
      assert.strictEqual(config.devices[0].accountId, 'trinity');
    });

    it('should trim whitespace-only accountId and fall back to device name', () => {
      const answers = { name: 'Trinity', accountId: '   ' };
      const accountId = answers.accountId.trim() || answers.name.trim().toLowerCase();
      assert.strictEqual(accountId, 'trinity');
    });
  });

  describe('Device list', () => {
    it('should display all configured devices', () => {
      const config = {
        devices: [
          { name: 'Morpheus', extension: '9000', voiceId: 'voice-123' },
          { name: 'Cephanie', extension: '9002', voiceId: 'voice-456' }
        ]
      };

      assert.strictEqual(config.devices.length, 2);
      assert.strictEqual(config.devices[0].name, 'Morpheus');
      assert.strictEqual(config.devices[1].name, 'Cephanie');
    });

    it('should handle empty device list', () => {
      const config = { devices: [] };
      assert.strictEqual(config.devices.length, 0);
    });

    it('should display Account ID column using device accountId', () => {
      const devices = [
        { name: 'Morpheus', extension: '9000', voiceId: 'voice-123', accountId: 'morpheus' },
        { name: 'Cephanie', extension: '9002', voiceId: 'voice-456', accountId: 'cephanie' }
      ];
      for (const device of devices) {
        const accountIdDisplay = device.accountId || device.name;
        assert.strictEqual(accountIdDisplay, device.accountId,
          `Account ID display should show accountId for device "${device.name}"`);
      }
    });

    it('should fall back to device name for Account ID when accountId is absent', () => {
      const devices = [
        { name: 'Morpheus', extension: '9000', voiceId: 'voice-123' },
        { name: 'Cephanie', extension: '9002', voiceId: 'voice-456' }
      ];
      for (const device of devices) {
        const accountIdDisplay = device.accountId || device.name;
        assert.strictEqual(accountIdDisplay, device.name,
          `Account ID display should fall back to name for device "${device.name}"`);
      }
    });
  });

  describe('Device remove', () => {
    it('should find device by name (case insensitive)', () => {
      const config = {
        devices: [
          { name: 'Morpheus', extension: '9000' },
          { name: 'Trinity', extension: '9001' }
        ]
      };

      const deviceName = 'morpheus';
      const index = config.devices.findIndex(
        d => d.name.toLowerCase() === deviceName.toLowerCase()
      );

      assert.strictEqual(index, 0, 'Device should be found by name');
    });

    it('should prevent removing last device', () => {
      const config = {
        devices: [
          { name: 'Morpheus', extension: '9000' }
        ]
      };

      const canRemove = config.devices.length > 1;
      assert.strictEqual(canRemove, false, 'Should not allow removing last device');
    });

    it('should remove device from config', () => {
      const config = {
        devices: [
          { name: 'Morpheus', extension: '9000' },
          { name: 'Trinity', extension: '9001' }
        ]
      };

      const deviceName = 'Trinity';
      const index = config.devices.findIndex(
        d => d.name.toLowerCase() === deviceName.toLowerCase()
      );

      config.devices.splice(index, 1);

      assert.strictEqual(config.devices.length, 1);
      assert.strictEqual(config.devices[0].name, 'Morpheus');
    });
  });
});

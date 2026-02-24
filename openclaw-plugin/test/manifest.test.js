'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MANIFEST_PATH = path.resolve(__dirname, '../openclaw.plugin.json');
const PACKAGE_PATH = path.resolve(__dirname, '../package.json');

test('manifest - has all 6 required top-level fields', () => {
  const manifest = require(MANIFEST_PATH);
  const required = ['id', 'version', 'name', 'description', 'main', 'configSchema'];
  for (const field of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(manifest, field),
      `Manifest must have field: ${field}`);
  }
});

test('manifest - main points to src/index.js', () => {
  const manifest = require(MANIFEST_PATH);
  assert.strictEqual(manifest.main, 'src/index.js',
    'main must be "src/index.js"');
});

test('manifest - id is openclaw-sip-voice', () => {
  const manifest = require(MANIFEST_PATH);
  assert.strictEqual(manifest.id, 'openclaw-sip-voice');
});

test('manifest - configSchema has all required config fields', () => {
  const manifest = require(MANIFEST_PATH);
  const schema = manifest.configSchema;
  const required = ['webhookPort', 'apiKey', 'dmPolicy', 'accounts', 'bindings', 'identityLinks'];
  for (const field of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(schema, field),
      `configSchema must have field: ${field}`);
  }
});

test('manifest - webhookPort has numeric type and default 47334', () => {
  const manifest = require(MANIFEST_PATH);
  const port = manifest.configSchema.webhookPort;
  assert.strictEqual(port.type, 'number');
  assert.strictEqual(port.default, 47334);
});

test('package.json - name is openclaw-sip-voice', () => {
  const pkg = require(PACKAGE_PATH);
  assert.strictEqual(pkg.name, 'openclaw-sip-voice');
});

test('package.json - does NOT have type: module (CommonJS)', () => {
  const pkg = require(PACKAGE_PATH);
  assert.ok(pkg.type !== 'module',
    'package.json must not set type:module — plugin must be CommonJS');
});

test('package.json - has express as a dependency', () => {
  const pkg = require(PACKAGE_PATH);
  assert.ok(pkg.dependencies && pkg.dependencies.express,
    'express must be listed as a dependency');
});

test('package.json - express version is ^4', () => {
  const pkg = require(PACKAGE_PATH);
  assert.ok(pkg.dependencies.express.startsWith('^4'),
    'express version must be ^4');
});

// L1: dmPolicy default must be "allowlist" — architecture security requirement
test('manifest - dmPolicy default is "allowlist"', () => {
  const manifest = require(MANIFEST_PATH);
  assert.strictEqual(manifest.configSchema.dmPolicy.default, 'allowlist',
    'dmPolicy default must be "allowlist" (mandatory security default for DID-exposed extensions)');
});

// L3: package.json must be private to prevent accidental npm publish
test('package.json - is marked private', () => {
  const pkg = require(PACKAGE_PATH);
  assert.strictEqual(pkg.private, true,
    'package.json must have "private": true to prevent accidental npm publish');
});

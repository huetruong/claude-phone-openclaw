'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Capture console output for testing
function captureOutput(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => lines.push({ method: 'log', text: args.join(' ') });
  console.warn = (...args) => lines.push({ method: 'warn', text: args.join(' ') });
  console.error = (...args) => lines.push({ method: 'error', text: args.join(' ') });
  try {
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return lines;
}

// Re-require logger fresh each time (clear module cache)
function requireLogger() {
  delete require.cache[require.resolve('../src/logger')];
  return require('../src/logger');
}

test('logger - info() prefixes with [sip-voice]', () => {
  const logger = requireLogger();
  const lines = captureOutput(() => logger.info('test message'));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].text.includes('[sip-voice]'), 'Must include [sip-voice] prefix');
  assert.ok(lines[0].text.includes('test message'), 'Must include the message');
});

test('logger - warn() prefixes with [sip-voice]', () => {
  const logger = requireLogger();
  const lines = captureOutput(() => logger.warn('warn message'));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].text.includes('[sip-voice]'), 'Must include [sip-voice] prefix');
  assert.ok(lines[0].text.includes('warn message'), 'Must include the message');
  assert.strictEqual(lines[0].method, 'warn', 'warn() must use console.warn');
});

test('logger - error() prefixes with [sip-voice]', () => {
  const logger = requireLogger();
  const lines = captureOutput(() => logger.error('error message'));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].text.includes('[sip-voice]'), 'Must include [sip-voice] prefix');
  assert.ok(lines[0].text.includes('error message'), 'Must include the message');
  assert.strictEqual(lines[0].method, 'error', 'error() must use console.error');
});

test('logger - debug() suppressed when DEBUG env not set', () => {
  delete process.env.DEBUG;
  const logger = requireLogger();
  const lines = captureOutput(() => logger.debug('debug message'));
  assert.strictEqual(lines.length, 0, 'debug() must not output when DEBUG is unset');
});

test('logger - debug() outputs when DEBUG env is set', () => {
  process.env.DEBUG = '1';
  const logger = requireLogger();
  const lines = captureOutput(() => logger.debug('debug message'));
  delete process.env.DEBUG;
  assert.strictEqual(lines.length, 1, 'debug() must output when DEBUG is set');
  assert.ok(lines[0].text.includes('[sip-voice]'), 'Must include [sip-voice] prefix');
  assert.ok(lines[0].text.includes('debug message'), 'Must include the message');
});

test('logger - data object is serialized into output', () => {
  const logger = requireLogger();
  const lines = captureOutput(() => logger.info('channel registered', { accounts: 2, bindings: 1 }));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].text.includes('"accounts":2') || lines[0].text.includes('"accounts": 2'),
    'Must serialize data object');
});

test('logger - info() uses console.log', () => {
  const logger = requireLogger();
  const lines = captureOutput(() => logger.info('message'));
  assert.strictEqual(lines[0].method, 'log', 'info() must use console.log');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Use a single module instance; call clear() before each test for isolation.
const store = require('../src/session-store');

function setup() {
  store.clear();
}

test('session-store - starts empty', () => {
  setup();
  assert.strictEqual(store.size(), 0);
});

test('session-store - create() and get() round-trip', () => {
  setup();
  store.create('call-uuid-1', 'session-abc');
  assert.strictEqual(store.get('call-uuid-1'), 'session-abc');
});

test('session-store - get() returns undefined for unknown callId', () => {
  setup();
  assert.strictEqual(store.get('nonexistent-id'), undefined);
});

test('session-store - remove() deletes the entry', () => {
  setup();
  store.create('call-1', 'sess-1');
  store.remove('call-1');
  assert.strictEqual(store.get('call-1'), undefined);
  assert.strictEqual(store.size(), 0);
});

test('session-store - remove() on nonexistent callId does not throw', () => {
  setup();
  assert.doesNotThrow(() => store.remove('does-not-exist'));
});

test('session-store - clear() removes all entries', () => {
  setup();
  store.create('call-1', 'sess-1');
  store.create('call-2', 'sess-2');
  store.create('call-3', 'sess-3');
  assert.strictEqual(store.size(), 3);
  store.clear();
  assert.strictEqual(store.size(), 0);
  assert.strictEqual(store.get('call-1'), undefined);
});

test('session-store - clear() on empty store does not throw', () => {
  setup();
  assert.doesNotThrow(() => store.clear());
  assert.strictEqual(store.size(), 0);
});

test('session-store - size() tracks count correctly', () => {
  setup();
  assert.strictEqual(store.size(), 0);
  store.create('call-1', 'sess-1');
  assert.strictEqual(store.size(), 1);
  store.create('call-2', 'sess-2');
  assert.strictEqual(store.size(), 2);
  store.remove('call-1');
  assert.strictEqual(store.size(), 1);
});

test('session-store - create() with existing callId overwrites (no duplicate)', () => {
  setup();
  store.create('call-1', 'sess-original');
  store.create('call-1', 'sess-updated');
  assert.strictEqual(store.get('call-1'), 'sess-updated');
  assert.strictEqual(store.size(), 1);
});

test('session-store - multiple independent callIds coexist', () => {
  setup();
  store.create('call-A', 'sess-A');
  store.create('call-B', 'sess-B');
  assert.strictEqual(store.get('call-A'), 'sess-A');
  assert.strictEqual(store.get('call-B'), 'sess-B');
  assert.strictEqual(store.size(), 2);
});

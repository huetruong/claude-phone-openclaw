'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function requireAuth() {
  delete require.cache[require.resolve('../src/auth')];
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  return require('../src/auth');
}

function mockReqRes(authHeader) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    method: 'POST',
    path: '/voice/query'
  };
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; }
  };
  return { req, res };
}

test('auth - missing Authorization header returns 401', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.deepStrictEqual(res._body, { error: 'unauthorized' });
  assert.strictEqual(nextCalled, false);
});

test('auth - wrong Bearer token returns 401', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes('Bearer wrong-key');
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.deepStrictEqual(res._body, { error: 'unauthorized' });
  assert.strictEqual(nextCalled, false);
});

test('auth - correct Bearer token calls next()', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes('Bearer test-key');
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res._status, null, 'Should not set status when auth passes');
});

test('auth - non-Bearer scheme returns 401', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes('Basic dXNlcjpwYXNz');
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.strictEqual(nextCalled, false);
});

test('auth - empty Bearer value returns 401', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes('Bearer ');
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.strictEqual(nextCalled, false);
});

test('auth - failure is logged at WARN level without including the token', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes('Bearer wrong-key');

  const warnLines = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnLines.push(args.join(' '));
  try {
    middleware(req, res, () => {});
  } finally {
    console.warn = origWarn;
  }

  assert.strictEqual(warnLines.length, 1, 'Must emit exactly one WARN log on auth failure');
  assert.ok(warnLines[0].includes('WARN'), 'Log must be at WARN level');
  assert.ok(warnLines[0].includes('[sip-voice]'), 'Log must include [sip-voice] prefix');
  assert.ok(!warnLines[0].includes('wrong-key'), 'Must NOT include the submitted token');
  assert.ok(!warnLines[0].includes('test-key'), 'Must NOT include the configured API key');
});

test('auth - createAuthMiddleware throws if apiKey is empty string', () => {
  const { createAuthMiddleware } = requireAuth();
  assert.throws(
    () => createAuthMiddleware(''),
    /apiKey is required/,
    'Must throw when apiKey is empty string'
  );
});

test('auth - createAuthMiddleware throws if apiKey is undefined', () => {
  const { createAuthMiddleware } = requireAuth();
  assert.throws(
    () => createAuthMiddleware(undefined),
    /apiKey is required/,
    'Must throw when apiKey is undefined'
  );
});

test('auth - missing header is logged at WARN level', () => {
  const { createAuthMiddleware } = requireAuth();
  const middleware = createAuthMiddleware('test-key');
  const { req, res } = mockReqRes(); // no header

  const warnLines = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnLines.push(args.join(' '));
  try {
    middleware(req, res, () => {});
  } finally {
    console.warn = origWarn;
  }

  assert.strictEqual(warnLines.length, 1, 'Must emit exactly one WARN log for missing header');
  assert.ok(warnLines[0].includes('WARN'), 'Log must be at WARN level');
});

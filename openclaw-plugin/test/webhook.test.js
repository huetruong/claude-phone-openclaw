'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

function requireWebhookServer() {
  delete require.cache[require.resolve('../src/webhook-server')];
  try { delete require.cache[require.resolve('../src/auth')]; } catch { /* ignore */ }
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  return require('../src/webhook-server');
}

/**
 * Makes an HTTP request against a live test server.
 * Port 0 means the OS assigns a free port; server.address().port gives the actual port.
 */
function request(server, opts, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: opts.path,
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Starts a test server on OS-assigned port, runs fn(server), then closes. */
async function withServer(config, fn) {
  const { createServer, startServer } = requireWebhookServer();
  const app = createServer(config);
  const server = await startServer(app, 0);
  try {
    await fn(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ── Health endpoint ────────────────────────────────────────────────────────────

test('webhook - GET /voice/health returns 200 { ok: true }', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    const res = await request(server, { path: '/voice/health' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  });
});

test('webhook - GET /voice/health requires no Authorization header (unauthenticated)', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    // Deliberately send no Authorization header — must still succeed.
    const res = await request(server, { path: '/voice/health' });
    assert.strictEqual(res.status, 200, 'Health endpoint must not require auth');
  });
});

// ── Auth enforcement on protected routes ──────────────────────────────────────

test('webhook - POST /voice/query without auth returns 401', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    const res = await request(server, { path: '/voice/query', method: 'POST' });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });
});

test('webhook - POST /voice/end-session without auth returns 401', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    const res = await request(server, { path: '/voice/end-session', method: 'POST' });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });
});

test('webhook - POST /voice/query with wrong token returns 401', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    const res = await request(server, {
      path: '/voice/query',
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key' }
    });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });
});

// ── Stub routes (501 — implemented in Story 1.3) ──────────────────────────────

test('webhook - POST /voice/query with correct token returns 501 stub', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    const res = await request(server, {
      path: '/voice/query',
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' }
    }, { prompt: 'hello', callId: 'uuid-1', accountId: 'morpheus', peerId: '+15551234567' });
    assert.strictEqual(res.status, 501);
    assert.deepStrictEqual(res.body, { error: 'not implemented' });
  });
});

test('webhook - POST /voice/end-session with correct token returns 501 stub', async () => {
  await withServer({ apiKey: 'test-key' }, async (server) => {
    const res = await request(server, {
      path: '/voice/end-session',
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' }
    }, { callId: 'uuid-1' });
    assert.strictEqual(res.status, 501);
    assert.deepStrictEqual(res.body, { error: 'not implemented' });
  });
});

// ── Server startup ────────────────────────────────────────────────────────────

test('webhook - startServer logs [sip-voice] webhook server listening on port <N>', async () => {
  const { createServer, startServer } = requireWebhookServer();
  const app = createServer({ apiKey: 'test-key' });

  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));

  let server;
  try {
    server = await startServer(app, 0);
  } finally {
    console.log = origLog;
  }

  const actualPort = server.address().port;
  try {
    const matched = logLines.some((line) =>
      line.includes('[sip-voice]') &&
      line.includes('webhook server listening on port') &&
      line.includes(String(actualPort))
    );
    assert.ok(matched, `Must log "[sip-voice] webhook server listening on port ${actualPort}"`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('webhook - startServer rejects when port is already in use', async () => {
  const { createServer, startServer } = requireWebhookServer();

  // Start first server on an explicit port
  const app1 = createServer({ apiKey: 'k1' });
  const server1 = await startServer(app1, 0);
  const usedPort = server1.address().port;

  try {
    const app2 = createServer({ apiKey: 'k2' });
    await assert.rejects(
      startServer(app2, usedPort),
      (err) => err.code === 'EADDRINUSE',
      'startServer must reject when port is already in use'
    );
  } finally {
    await new Promise((resolve) => server1.close(resolve));
  }
});

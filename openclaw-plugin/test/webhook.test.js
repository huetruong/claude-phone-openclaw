'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

function requireFresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function requireWebhookServer() {
  delete require.cache[require.resolve('../src/webhook-server')];
  try { delete require.cache[require.resolve('../src/auth')]; } catch { /* ignore */ }
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  try { delete require.cache[require.resolve('../src/session-store')]; } catch { /* ignore */ }
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

// Default test config with mock queryAgent.
const TEST_BINDINGS = [
  { accountId: 'morpheus', agentId: 'morpheus' },
  { accountId: 'cephanie', agentId: 'cephanie' }
];

function makeConfig(overrides = {}) {
  return {
    apiKey: 'test-key',
    bindings: TEST_BINDINGS,
    queryAgent: async () => 'mock agent reply',
    ...overrides
  };
}

const AUTH = { Authorization: 'Bearer test-key' };

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

// Clear session store before each test to avoid cross-test state.
beforeEach(() => {
  try {
    const sessionStore = requireFresh('../src/session-store');
    sessionStore.clear();
  } catch { /* ignore */ }
});

// ── Health endpoint ────────────────────────────────────────────────────────────

test('webhook - GET /voice/health returns 200 { ok: true }', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, { path: '/voice/health' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  });
});

test('webhook - GET /voice/health requires no Authorization header (unauthenticated)', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, { path: '/voice/health' });
    assert.strictEqual(res.status, 200, 'Health endpoint must not require auth');
  });
});

// ── Auth enforcement on protected routes ──────────────────────────────────────

test('webhook - POST /voice/query without auth returns 401', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, { path: '/voice/query', method: 'POST' });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });
});

test('webhook - POST /voice/end-session without auth returns 401', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, { path: '/voice/end-session', method: 'POST' });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });
});

test('webhook - POST /voice/query with wrong token returns 401', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/query',
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key' }
    });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });
});

// ── POST /voice/query — successful agent query ───────────────────────────────

test('webhook - POST /voice/query returns 200 with agent response', async () => {
  const queryAgent = async () => 'Hello from Morpheus';
  await withServer(makeConfig({ queryAgent }), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hello', callId: 'uuid-1', accountId: 'morpheus', peerId: '+15551234567' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { response: 'Hello from Morpheus' });
  });
});

test('webhook - POST /voice/query passes correct args to queryAgent', async () => {
  const calls = [];
  const queryAgent = async (agentId, sessionId, prompt, peerId) => {
    calls.push({ agentId, sessionId, prompt, peerId });
    return 'ok';
  };
  await withServer(makeConfig({ queryAgent }), async (server) => {
    await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'test prompt', callId: 'call-abc', accountId: 'morpheus', peerId: '+15559999999' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].agentId, 'morpheus');
    assert.strictEqual(calls[0].prompt, 'test prompt');
    assert.strictEqual(calls[0].peerId, '+15559999999');
  });
});

// ── POST /voice/query — session management ───────────────────────────────────

test('webhook - POST /voice/query creates session store entry for new callId', async () => {
  await withServer(makeConfig(), async (server) => {
    const sessionStore = require('../src/session-store');
    assert.strictEqual(sessionStore.get('new-call-1'), undefined, 'Session must not exist yet');

    await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hi', callId: 'new-call-1', accountId: 'morpheus', peerId: '+15551234567' });

    assert.ok(sessionStore.get('new-call-1'), 'Session must exist after first query');
  });
});

test('webhook - POST /voice/query resumes session for existing callId (no duplicate)', async () => {
  const calls = [];
  const queryAgent = async (agentId, sessionId) => {
    calls.push(sessionId);
    return 'ok';
  };
  await withServer(makeConfig({ queryAgent }), async (server) => {
    // First query — creates session.
    await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'first', callId: 'call-resume', accountId: 'morpheus', peerId: '+1' });

    // Second query — resumes same session.
    await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'second', callId: 'call-resume', accountId: 'morpheus', peerId: '+1' });

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0], calls[1], 'Both queries must use the same sessionId');
  });
});

// ── POST /voice/query — validation errors ────────────────────────────────────

test('webhook - POST /voice/query missing prompt returns 400', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { callId: 'uuid-1', accountId: 'morpheus' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'missing required field: prompt' });
  });
});

test('webhook - POST /voice/query missing callId returns 400', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hello', accountId: 'morpheus' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'missing required field: callId' });
  });
});

test('webhook - POST /voice/query missing accountId returns 400', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hello', callId: 'uuid-1' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'missing required field: accountId' });
  });
});

test('webhook - POST /voice/query unknown accountId returns 404', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hello', callId: 'uuid-1', accountId: 'unknown-agent', peerId: '+1' });
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'no agent binding for accountId' });
  });
});

// ── POST /voice/query — agent error returns 503 ─────────────────────────────

test('webhook - POST /voice/query agent error returns 503', async () => {
  const queryAgent = async () => { throw new Error('agent crashed'); };
  await withServer(makeConfig({ queryAgent }), async (server) => {
    const res = await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hello', callId: 'uuid-1', accountId: 'morpheus', peerId: '+1' });
    assert.strictEqual(res.status, 503);
    assert.deepStrictEqual(res.body, { error: 'agent unavailable' });
  });
});

// ── POST /voice/end-session ──────────────────────────────────────────────────

test('webhook - POST /voice/end-session removes session and returns { ok: true }', async () => {
  await withServer(makeConfig(), async (server) => {
    const sessionStore = require('../src/session-store');

    // Create a session first via /voice/query.
    await request(server, {
      path: '/voice/query', method: 'POST', headers: AUTH
    }, { prompt: 'hi', callId: 'end-me', accountId: 'morpheus', peerId: '+1' });
    assert.ok(sessionStore.get('end-me'), 'Session must exist before end-session');

    // End the session.
    const res = await request(server, {
      path: '/voice/end-session', method: 'POST', headers: AUTH
    }, { callId: 'end-me' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
    assert.strictEqual(sessionStore.get('end-me'), undefined, 'Session must be removed');
  });
});

test('webhook - POST /voice/end-session missing callId in store still returns 200', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/end-session', method: 'POST', headers: AUTH
    }, { callId: 'nonexistent-call' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  });
});

test('webhook - POST /voice/end-session missing callId field returns 400', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/end-session', method: 'POST', headers: AUTH
    }, {});
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'missing required field: callId' });
  });
});

// ── PII discipline: peerId never in INFO/WARN/ERROR ──────────────────────────

test('webhook - peerId never appears in INFO/WARN/ERROR logs', async () => {
  const logLines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => logLines.push(args.join(' '));
  console.warn = (...args) => logLines.push(args.join(' '));
  console.error = (...args) => logLines.push(args.join(' '));

  try {
    await withServer(makeConfig(), async (server) => {
      await request(server, {
        path: '/voice/query', method: 'POST', headers: AUTH
      }, { prompt: 'hi', callId: 'pii-test', accountId: 'morpheus', peerId: '+15559876543' });
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  // Filter to INFO/WARN/ERROR lines only (exclude DEBUG).
  const nonDebugLines = logLines.filter((line) =>
    (line.includes('INFO') || line.includes('WARN') || line.includes('ERROR'))
  );
  for (const line of nonDebugLines) {
    assert.ok(!line.includes('+15559876543'),
      `peerId must not appear in non-DEBUG log: ${line}`);
  }
});

// ── Unknown routes ────────────────────────────────────────────────────────────

test('webhook - unknown non-voice route returns 404 JSON', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, { path: '/api/unknown' });
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'not found' });
  });
});

test('webhook - unknown /voice route with valid auth returns 404 JSON', async () => {
  await withServer(makeConfig(), async (server) => {
    const res = await request(server, {
      path: '/voice/nonexistent',
      method: 'GET',
      headers: AUTH
    });
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'not found' });
  });
});

// ── Server startup ────────────────────────────────────────────────────────────

test('webhook - startServer logs [sip-voice] webhook server listening on port <N>', async () => {
  const { createServer, startServer } = requireWebhookServer();
  const app = createServer(makeConfig());

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

  const app1 = createServer(makeConfig({ apiKey: 'k1' }));
  const server1 = await startServer(app1, 0);
  const usedPort = server1.address().port;

  try {
    const app2 = createServer(makeConfig({ apiKey: 'k2' }));
    await assert.rejects(
      startServer(app2, usedPort),
      (err) => err.code === 'EADDRINUSE',
      'startServer must reject when port is already in use'
    );
  } finally {
    await new Promise((resolve) => server1.close(resolve));
  }
});

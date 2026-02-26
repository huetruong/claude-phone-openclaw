'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireOutboundClient() {
  delete require.cache[require.resolve('../src/outbound-client')];
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  return require('../src/outbound-client');
}

/**
 * Spin up a minimal mock HTTP server for integration-style tests.
 * The handler receives (req, body) and should return { status, body }.
 */
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', async () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        const result = await handler(req, parsed);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Unit tests — happy path and error paths (no real network)
// ---------------------------------------------------------------------------

test('outbound-client - returns { callId, status } on successful call', async () => {
  const server = await createMockServer(() => ({
    status: 200,
    body: { success: true, callId: 'abc-123', status: 'queued', device: 'morpheus' }
  }));

  try {
    const { port } = server.address();
    const client = requireOutboundClient();
    const result = await client.placeCall({
      voiceAppUrl: `http://127.0.0.1:${port}/api`,
      to: '12125550100',
      device: '9000',
      message: 'Your task is complete.',
    });
    assert.strictEqual(result.callId, 'abc-123');
    assert.strictEqual(result.status, 'queued');
    assert.ok(!result.error, 'Should not have error on success');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('outbound-client - POSTs to /outbound-call with correct body', async () => {
  let receivedBody = null;
  let receivedPath = null;

  const server = await createMockServer((req, body) => {
    receivedPath = req.url;
    receivedBody = body;
    return { status: 200, body: { success: true, callId: 'xyz-789', status: 'queued' } };
  });

  try {
    const { port } = server.address();
    const client = requireOutboundClient();
    await client.placeCall({
      voiceAppUrl: `http://127.0.0.1:${port}/api`,
      to: '12125550100',
      device: '9000',
      message: 'Task done.',
      mode: 'announce',
    });
    assert.strictEqual(receivedPath, '/api/outbound-call');
    assert.strictEqual(receivedBody.to, '12125550100');
    assert.strictEqual(receivedBody.device, '9000');
    assert.strictEqual(receivedBody.message, 'Task done.');
    assert.strictEqual(receivedBody.mode, 'announce');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('outbound-client - strips + prefix from phone number', async () => {
  let receivedBody = null;
  const server = await createMockServer((_req, body) => {
    receivedBody = body;
    return { status: 200, body: { success: true, callId: 'id-1', status: 'queued' } };
  });

  try {
    const { port } = server.address();
    const client = requireOutboundClient();
    await client.placeCall({
      voiceAppUrl: `http://127.0.0.1:${port}/api`,
      to: '+12125550100',
      device: '9000',
      message: 'Test.',
    });
    assert.strictEqual(receivedBody.to, '12125550100', 'Must strip leading +');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('outbound-client - defaults mode to announce when not provided', async () => {
  let receivedBody = null;
  const server = await createMockServer((_req, body) => {
    receivedBody = body;
    return { status: 200, body: { success: true, callId: 'id-2', status: 'queued' } };
  });

  try {
    const { port } = server.address();
    const client = requireOutboundClient();
    await client.placeCall({
      voiceAppUrl: `http://127.0.0.1:${port}/api`,
      to: '12125550100',
      device: '9000',
      message: 'Hello.',
    });
    assert.strictEqual(receivedBody.mode, 'announce');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('outbound-client - returns { error } when voice-app is unreachable (ECONNREFUSED)', async () => {
  // Use a port that is definitely not listening
  const client = requireOutboundClient();
  const result = await client.placeCall({
    voiceAppUrl: 'http://127.0.0.1:1', // port 1 should be unreachable
    to: '12125550100',
    device: '9000',
    message: 'Test.',
  });
  assert.ok(result.error, 'Should return error object');
  assert.ok(!result.callId, 'Should not have callId on failure');
});

test('outbound-client - returns { error } on non-200 HTTP response', async () => {
  const server = await createMockServer(() => ({
    status: 500,
    body: { error: 'Internal server error' }
  }));

  try {
    const { port } = server.address();
    const client = requireOutboundClient();
    const result = await client.placeCall({
      voiceAppUrl: `http://127.0.0.1:${port}/api`,
      to: '12125550100',
      device: '9000',
      message: 'Test.',
    });
    assert.ok(result.error, 'Should return error on 500 response');
    assert.ok(!result.callId, 'Should not have callId on failure');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('outbound-client - never throws even on connection error', async () => {
  const client = requireOutboundClient();
  // Should resolve (not reject) even when server is unreachable
  const result = await client.placeCall({
    voiceAppUrl: 'http://127.0.0.1:1',
    to: '12125550100',
    device: '9000',
    message: 'Test.',
  });
  assert.ok(typeof result === 'object', 'Must always return an object');
  assert.ok(result.error, 'Must return error object on failure');
});

test('outbound-client - logs error with [sip-voice] prefix on failure', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const client = requireOutboundClient();
    await client.placeCall({
      voiceAppUrl: 'http://127.0.0.1:1',
      to: '12125550100',
      device: '9000',
      message: 'Test.',
    });
    assert.ok(errors.length > 0, 'Should have logged an error');
    assert.ok(errors.some(e => e.includes('[sip-voice]')), 'Error must include [sip-voice] prefix');
  } finally {
    console.error = origError;
  }
});

test('outbound-client - returns { error } on invalid JSON response', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('not json');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    const { port } = server.address();
    const client = requireOutboundClient();
    const result = await client.placeCall({
      voiceAppUrl: `http://127.0.0.1:${port}/api`,
      to: '12125550100',
      device: '9000',
      message: 'Test.',
    });
    assert.ok(result.error, 'Should return error on invalid JSON');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

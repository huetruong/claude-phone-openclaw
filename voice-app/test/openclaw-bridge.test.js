'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const net = require('net');

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

let queryHandler = null;
let endSessionHandler = null;
let healthHandler = null;

app.post('/voice/query', (req, res) => {
  if (queryHandler) queryHandler(req, res);
  else res.json({ response: 'default' });
});

app.post('/voice/end-session', (req, res) => {
  if (endSessionHandler) endSessionHandler(req, res);
  else res.json({ ok: true });
});

app.get('/voice/health', (req, res) => {
  if (healthHandler) healthHandler(req, res);
  else res.json({ ok: true });
});

let server;
let testPort;
let refuseServer; // TCP server that immediately destroys connections — reliable ECONNRESET/ECONNREFUSED
let refusedPort;

function requireFreshBridge() {
  delete require.cache[require.resolve('../lib/openclaw-bridge')];
  return require('../lib/openclaw-bridge');
}

// ---------------------------------------------------------------------------
// openclaw-bridge.js tests (Task 4)
// ---------------------------------------------------------------------------

describe('openclaw-bridge', () => {
  before(async () => {
    // Start main test server
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    testPort = server.address().port;

    // Persistent TCP server that immediately destroys incoming sockets.
    // Stays alive for the full test run — no race window compared to the
    // "start then close" pattern where another process could grab the port.
    refuseServer = net.createServer(sock => sock.destroy());
    await new Promise(resolve => refuseServer.listen(0, resolve));
    refusedPort = refuseServer.address().port;

    process.env.OPENCLAW_WEBHOOK_URL = 'http://127.0.0.1:' + testPort;
    process.env.OPENCLAW_API_KEY = 'test-key';
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (refuseServer) await new Promise(resolve => refuseServer.close(resolve));
    delete process.env.OPENCLAW_WEBHOOK_URL;
    delete process.env.OPENCLAW_API_KEY;
  });

  beforeEach(() => {
    queryHandler = null;
    endSessionHandler = null;
    healthHandler = null;
  });

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  describe('query()', () => {
    it('returns agent response string on success', async () => {
      queryHandler = (req, res) => res.json({ response: 'Hello from agent' });
      const bridge = requireFreshBridge();
      const result = await bridge.query('test prompt', { callId: 'call-123' });
      assert.strictEqual(result, 'Hello from agent');
    });

    it('sends correct JSON body with prompt and callId', async () => {
      let capturedBody = null;
      queryHandler = (req, res) => {
        capturedBody = req.body;
        res.json({ response: 'ok' });
      };
      const bridge = requireFreshBridge();
      await bridge.query('my prompt', { callId: 'call-abc' });
      assert.strictEqual(capturedBody.prompt, 'my prompt');
      assert.strictEqual(capturedBody.callId, 'call-abc');
    });

    it('includes accountId and peerId in body when provided', async () => {
      let capturedBody = null;
      queryHandler = (req, res) => {
        capturedBody = req.body;
        res.json({ response: 'ok' });
      };
      const bridge = requireFreshBridge();
      await bridge.query('prompt', { callId: 'c1', accountId: 'morpheus', peerId: '+15551234567' });
      assert.strictEqual(capturedBody.accountId, 'morpheus');
      assert.strictEqual(capturedBody.peerId, '+15551234567');
    });

    it('omits accountId and peerId from body when undefined', async () => {
      let capturedBody = null;
      queryHandler = (req, res) => {
        capturedBody = req.body;
        res.json({ response: 'ok' });
      };
      const bridge = requireFreshBridge();
      await bridge.query('prompt', { callId: 'c1' });
      assert.strictEqual(capturedBody.accountId, undefined);
      assert.strictEqual(capturedBody.peerId, undefined);
    });

    it('sends Authorization: Bearer header', async () => {
      let capturedAuth = null;
      queryHandler = (req, res) => {
        capturedAuth = req.headers.authorization;
        res.json({ response: 'ok' });
      };
      const bridge = requireFreshBridge();
      await bridge.query('prompt', { callId: 'c1' });
      assert.strictEqual(capturedAuth, 'Bearer test-key');
    });

    it('returns friendly message on connection refused (not throw)', async () => {
      delete require.cache[require.resolve('../lib/openclaw-bridge')];
      const savedUrl = process.env.OPENCLAW_WEBHOOK_URL;
      process.env.OPENCLAW_WEBHOOK_URL = 'http://127.0.0.1:' + refusedPort;
      const bridge = require('../lib/openclaw-bridge');
      process.env.OPENCLAW_WEBHOOK_URL = savedUrl;

      const result = await bridge.query('prompt', { callId: 'c1' });
      assert.strictEqual(typeof result, 'string', 'should return string not throw');
      assert.ok(
        result.includes('trouble connecting') || result.includes('unexpected error'),
        'Expected friendly ECONNREFUSED message, got: ' + result
      );
    });

    it('returns friendly message on timeout (not throw)', async () => {
      queryHandler = (_req, res) => {
        // Delay longer than the 100ms timeout we'll set in the call
        setTimeout(() => res.json({ response: 'delayed' }), 500);
      };
      const bridge = requireFreshBridge();
      const result = await bridge.query('prompt', { callId: 'c1', timeout: 0.1 });
      assert.strictEqual(typeof result, 'string', 'should return string not throw');
      assert.ok(
        result.includes('took too long') || result.includes('unexpected error'),
        'Expected timeout message, got: ' + result
      );
    });

    it('returns unavailability message on HTTP 503 (not throw)', async () => {
      queryHandler = (req, res) => res.status(503).json({ error: 'service unavailable' });
      const bridge = requireFreshBridge();
      const result = await bridge.query('prompt', { callId: 'c1' });
      assert.strictEqual(typeof result, 'string', 'should return string not throw');
      assert.ok(
        result.includes('unavailable'),
        'Expected unavailability message, got: ' + result
      );
    });

    it('handles missing optional fields gracefully', async () => {
      queryHandler = (req, res) => res.json({ response: 'ok' });
      const bridge = requireFreshBridge();
      // No callId, accountId, or peerId
      const result = await bridge.query('just a prompt', {});
      assert.strictEqual(result, 'ok');
    });
  });

  // -------------------------------------------------------------------------
  // endSession()
  // -------------------------------------------------------------------------

  describe('endSession()', () => {
    it('sends POST to /voice/end-session with callId', async () => {
      let capturedBody = null;
      endSessionHandler = (req, res) => {
        capturedBody = req.body;
        res.json({ ok: true });
      };
      const bridge = requireFreshBridge();
      await bridge.endSession('call-xyz');
      assert.strictEqual(capturedBody.callId, 'call-xyz');
    });

    it('sends Authorization: Bearer header', async () => {
      let capturedAuth = null;
      endSessionHandler = (req, res) => {
        capturedAuth = req.headers.authorization;
        res.json({ ok: true });
      };
      const bridge = requireFreshBridge();
      await bridge.endSession('call-abc');
      assert.strictEqual(capturedAuth, 'Bearer test-key');
    });

    it('does not throw on server error', async () => {
      endSessionHandler = (req, res) => res.status(500).json({ error: 'oops' });
      const bridge = requireFreshBridge();
      await assert.doesNotReject(() => bridge.endSession('call-1'));
    });

    it('is a no-op when callId is falsy', async () => {
      let called = false;
      endSessionHandler = (req, res) => {
        called = true;
        res.json({ ok: true });
      };
      const bridge = requireFreshBridge();
      await bridge.endSession(null);
      assert.strictEqual(called, false, 'endSession should not send request for falsy callId');
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable()
  // -------------------------------------------------------------------------

  describe('isAvailable()', () => {
    it('returns true on HTTP 200', async () => {
      healthHandler = (req, res) => res.json({ ok: true });
      const bridge = requireFreshBridge();
      const result = await bridge.isAvailable();
      assert.strictEqual(result, true);
    });

    it('sends Authorization: Bearer header', async () => {
      let capturedAuth = null;
      healthHandler = (req, res) => {
        capturedAuth = req.headers.authorization;
        res.json({ ok: true });
      };
      const bridge = requireFreshBridge();
      await bridge.isAvailable();
      assert.strictEqual(capturedAuth, 'Bearer test-key');
    });

    it('returns false on network error', async () => {
      delete require.cache[require.resolve('../lib/openclaw-bridge')];
      const savedUrl = process.env.OPENCLAW_WEBHOOK_URL;
      process.env.OPENCLAW_WEBHOOK_URL = 'http://127.0.0.1:' + refusedPort;
      const bridge = require('../lib/openclaw-bridge');
      process.env.OPENCLAW_WEBHOOK_URL = savedUrl;

      const result = await bridge.isAvailable();
      assert.strictEqual(result, false);
    });

    it('returns false on non-200 response', async () => {
      healthHandler = (req, res) => res.status(503).json({ ok: false });
      const bridge = requireFreshBridge();
      const result = await bridge.isAvailable();
      assert.strictEqual(result, false);
    });
  });
});

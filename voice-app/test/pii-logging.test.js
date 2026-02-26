'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// sip-handler PII safety tests (Story 4.4 / AC4)
//
// Verifies that callerId (phone number) is never emitted to console.log,
// console.warn, or console.error — which back logger.info/warn/error.
// ---------------------------------------------------------------------------

describe('sip-handler PII logging (AC4)', () => {
  let origLog, origWarn, origError;
  let logLines, warnLines, errorLines;
  let origDebug;

  beforeEach(() => {
    origLog   = console.log;
    origWarn  = console.warn;
    origError = console.error;
    origDebug = process.env.DEBUG;

    logLines   = [];
    warnLines  = [];
    errorLines = [];

    // Suppress DEBUG to ensure logger.debug() is silent
    delete process.env.DEBUG;

    console.log   = (...args) => logLines.push(args.join(' '));
    console.warn  = (...args) => warnLines.push(args.join(' '));
    console.error = (...args) => errorLines.push(args.join(' '));
  });

  afterEach(() => {
    console.log   = origLog;
    console.warn  = origWarn;
    console.error = origError;
    if (origDebug !== undefined) {
      process.env.DEBUG = origDebug;
    } else {
      delete process.env.DEBUG;
    }
    // Clear module cache so each test gets a fresh sip-handler + logger
    delete require.cache[require.resolve('../lib/sip-handler')];
    delete require.cache[require.resolve('../lib/logger')];
  });

  it('callerId is absent from INFO/WARN/ERROR when bridge is unavailable', async () => {
    const { handleInvite } = require('../lib/sip-handler');
    const CALLER = '+15551234567';

    const req = {
      get: (header) => {
        if (header === 'From') return `<sip:${CALLER}@pbx.example.com>`;
        if (header === 'To')   return '<sip:9000@pbx.example.com>';
        return '';
      },
      body: 'v=0\r\n',
    };
    const res = { send: () => {} };
    const options = {
      deviceRegistry: null,
      claudeBridge: { isAvailable: async () => false },
      mediaServer: null,
    };

    await handleInvite(req, res, options);

    const allOutput = [...logLines, ...warnLines, ...errorLines].join('\n');
    assert.ok(
      !allOutput.includes(CALLER),
      `callerId "${CALLER}" must not appear in INFO/WARN/ERROR logs.\nCaptured output:\n${allOutput}`
    );
  });

  it('callerId is absent from INFO/WARN/ERROR when allowlist rejects caller', async () => {
    const { handleInvite } = require('../lib/sip-handler');
    const CALLER = '+19995551234';
    const ALLOWED = '+10000000000';

    const req = {
      get: (header) => {
        if (header === 'From') return `<sip:${CALLER}@pbx.example.com>`;
        if (header === 'To')   return '<sip:9001@pbx.example.com>';
        return '';
      },
      body: 'v=0\r\n',
    };
    const res = { send: () => {} };
    const options = {
      // deviceConfig with non-empty allowFrom that excludes CALLER
      deviceRegistry: {
        get: () => ({ extension: '9001', name: 'cephanie', allowFrom: [ALLOWED] }),
        getDefault: () => null,
      },
      claudeBridge: { isAvailable: async () => true },
      mediaServer: null,
    };

    await handleInvite(req, res, options);

    const allOutput = [...logLines, ...warnLines, ...errorLines].join('\n');
    assert.ok(
      !allOutput.includes(CALLER),
      `callerId "${CALLER}" must not appear in INFO/WARN/ERROR logs (rejected call).\nCaptured:\n${allOutput}`
    );
  });

  it('INFO log includes extension but not callerId', async () => {
    const { handleInvite } = require('../lib/sip-handler');
    const CALLER = '+15559876543';

    const req = {
      get: (header) => {
        if (header === 'From') return `<sip:${CALLER}@pbx.example.com>`;
        if (header === 'To')   return '<sip:9000@pbx.example.com>';
        return '';
      },
      body: 'v=0\r\n',
    };
    const res = { send: () => {} };
    const options = {
      deviceRegistry: null,
      claudeBridge: { isAvailable: async () => false },
      mediaServer: null,
    };

    await handleInvite(req, res, options);

    const infoOutput = logLines.join('\n');
    // INFO log must include the extension
    assert.ok(
      infoOutput.includes('9000') || infoOutput.includes('Incoming call'),
      `INFO log must reference extension or "Incoming call".\nGot: ${infoOutput}`
    );
    // But must not include the callerId
    assert.ok(
      !infoOutput.includes(CALLER),
      `INFO log must not include callerId "${CALLER}".\nGot: ${infoOutput}`
    );
  });

  it('callerId IS present in DEBUG output when DEBUG env is set', async () => {
    process.env.DEBUG = '1';
    delete require.cache[require.resolve('../lib/sip-handler')];
    delete require.cache[require.resolve('../lib/logger')];

    const { handleInvite } = require('../lib/sip-handler');
    const CALLER = '+15550001111';

    const req = {
      get: (header) => {
        if (header === 'From') return `<sip:${CALLER}@pbx.example.com>`;
        if (header === 'To')   return '<sip:9000@pbx.example.com>';
        return '';
      },
      body: 'v=0\r\n',
    };
    const res = { send: () => {} };
    const options = {
      deviceRegistry: null,
      claudeBridge: { isAvailable: async () => false },
      mediaServer: null,
    };

    await handleInvite(req, res, options);

    const debugOutput = logLines.join('\n');
    assert.ok(
      debugOutput.includes(CALLER),
      `callerId "${CALLER}" must appear in DEBUG output when DEBUG env is set.\nGot: ${debugOutput}`
    );
  });
});

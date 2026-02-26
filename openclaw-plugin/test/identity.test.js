'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function requireIdentity() {
  delete require.cache[require.resolve('../src/identity')];
  try { delete require.cache[require.resolve('../src/logger')]; } catch { /* ignore */ }
  return require('../src/identity');
}

// ── resolveIdentity ────────────────────────────────────────────────────────────

test('identity - resolveIdentity: null config returns isFirstCall=true', () => {
  const { resolveIdentity } = requireIdentity();
  const result = resolveIdentity(null, '+15551234567');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

test('identity - resolveIdentity: empty config object returns isFirstCall=true', () => {
  const { resolveIdentity } = requireIdentity();
  const result = resolveIdentity({}, '+15551234567');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

test('identity - resolveIdentity: no session.identityLinks returns isFirstCall=true', () => {
  const { resolveIdentity } = requireIdentity();
  const result = resolveIdentity({ session: {} }, '+15551234567');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

test('identity - resolveIdentity: empty identityLinks returns isFirstCall=true', () => {
  const { resolveIdentity } = requireIdentity();
  const result = resolveIdentity({ session: { identityLinks: {} } }, '+15551234567');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

test('identity - resolveIdentity: known caller with + prefix returns identity', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        hue: ['sip-voice:15551234567'],
      },
    },
  };
  const result = resolveIdentity(config, '+15551234567');
  assert.deepStrictEqual(result, { isFirstCall: false, identity: 'hue' });
});

test('identity - resolveIdentity: known caller without + prefix returns identity', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        hue: ['sip-voice:15551234567'],
      },
    },
  };
  const result = resolveIdentity(config, '15551234567');
  assert.deepStrictEqual(result, { isFirstCall: false, identity: 'hue' });
});

test('identity - resolveIdentity: format normalization — stored with + matches caller without +', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        alice: ['sip-voice:+15559999999'],
      },
    },
  };
  const result = resolveIdentity(config, '15559999999');
  assert.deepStrictEqual(result, { isFirstCall: false, identity: 'alice' });
});

test('identity - resolveIdentity: format normalization — caller with + matches stored without +', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        alice: ['sip-voice:15559999999'],
      },
    },
  };
  const result = resolveIdentity(config, '+15559999999');
  assert.deepStrictEqual(result, { isFirstCall: false, identity: 'alice' });
});

test('identity - resolveIdentity: unknown caller returns isFirstCall=true, identity=null', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        hue: ['sip-voice:15551234567'],
      },
    },
  };
  const result = resolveIdentity(config, '+15559999999');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

test('identity - resolveIdentity: multiple identities — matches correct one', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        alice: ['sip-voice:15551111111', 'discord:alice123'],
        bob: ['sip-voice:15552222222', 'discord:bob456'],
      },
    },
  };
  const resultAlice = resolveIdentity(config, '+15551111111');
  assert.deepStrictEqual(resultAlice, { isFirstCall: false, identity: 'alice' });

  const resultBob = resolveIdentity(config, '+15552222222');
  assert.deepStrictEqual(resultBob, { isFirstCall: false, identity: 'bob' });
});

test('identity - resolveIdentity: non-sip-voice channels are skipped', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        hue: ['discord:huetruong', 'telegram:@hue'],
      },
    },
  };
  const result = resolveIdentity(config, '15551234567');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

test('identity - resolveIdentity: channels value not array is skipped gracefully', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        broken: 'not-an-array',
        hue: ['sip-voice:15551234567'],
      },
    },
  };
  const result = resolveIdentity(config, '15551234567');
  assert.deepStrictEqual(result, { isFirstCall: false, identity: 'hue' });
});

test('identity - resolveIdentity: empty peerId returns isFirstCall=true', () => {
  const { resolveIdentity } = requireIdentity();
  const config = {
    session: {
      identityLinks: {
        hue: ['sip-voice:15551234567'],
      },
    },
  };
  const result = resolveIdentity(config, '');
  assert.deepStrictEqual(result, { isFirstCall: true, identity: null });
});

// ── createLinkIdentityHandler ──────────────────────────────────────────────────

function makeMockApi(overrides = {}) {
  const cfg = { session: {}, ...(overrides.config || {}) };
  const writes = [];
  const writeError = overrides.writeError || null;

  const api = {
    config: cfg,
    runtime: {
      config: {
        writeConfigFile: async (c) => {
          if (writeError) throw writeError;
          writes.push(JSON.parse(JSON.stringify(c)));
        },
      },
    },
    _writes: writes,
  };
  return api;
}

test('identity - link_identity: successful enrollment returns { ok: true, identity }', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  const result = await handler({ name: 'hue', channels: ['discord:hue123'], peerId: '+15551234567' });
  assert.deepStrictEqual(result, { ok: true, identity: 'hue' });
});

test('identity - link_identity: writes sip-voice channel without leading +', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  await handler({ name: 'hue', channels: ['discord:hue123'], peerId: '+15551234567' });
  assert.strictEqual(api._writes.length, 1);
  const written = api._writes[0];
  assert.deepStrictEqual(
    written.session.identityLinks['hue'],
    ['sip-voice:15551234567', 'discord:hue123']
  );
});

test('identity - link_identity: strips leading + from peerId in stored channel', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  await handler({ name: 'alice', peerId: '+15559999999' });
  assert.strictEqual(api._writes[0].session.identityLinks['alice'][0], 'sip-voice:15559999999');
});

test('identity - link_identity: channels parameter is optional', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  const result = await handler({ name: 'bob', peerId: '15552222222' });
  assert.deepStrictEqual(result, { ok: true, identity: 'bob' });
  assert.deepStrictEqual(api._writes[0].session.identityLinks['bob'], ['sip-voice:15552222222']);
});

test('identity - link_identity: overwrites existing identityLinks entry for same name', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi({
    config: {
      session: {
        identityLinks: {
          hue: ['sip-voice:old-number'],
        },
      },
    },
  });
  const handler = createLinkIdentityHandler(api);

  await handler({ name: 'hue', peerId: '15551234567' });
  assert.deepStrictEqual(
    api._writes[0].session.identityLinks['hue'],
    ['sip-voice:15551234567']
  );
});

test('identity - link_identity: config write failure returns { ok: false, error } without throwing', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi({ writeError: new Error('disk full') });
  const handler = createLinkIdentityHandler(api);

  const result = await handler({ name: 'hue', peerId: '+15551234567' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('disk full'), 'error message must include cause');
});

test('identity - link_identity: config write failure rolls back in-memory identityLinks', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi({ writeError: new Error('disk full') });
  const handler = createLinkIdentityHandler(api);

  await handler({ name: 'hue', peerId: '+15551234567' });

  // In-memory config must NOT have the enrollment after a failed write (AC 6).
  const enrolled = api.config.session &&
    api.config.session.identityLinks &&
    api.config.session.identityLinks['hue'];
  assert.strictEqual(enrolled, undefined,
    'Failed write must not leave enrollment in in-memory config');
  assert.strictEqual(api._writes.length, 0, 'writeConfigFile must not have completed');
});

test('identity - link_identity: missing peerId returns { ok: false, error } without writing config', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  const result = await handler({ name: 'hue', peerId: undefined });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error, 'must include error message');
  assert.strictEqual(api._writes.length, 0, 'must not write config when peerId is missing');
});

test('identity - link_identity: null peerId returns { ok: false, error } without writing config', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  const result = await handler({ name: 'hue', peerId: null });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error, 'must include error message');
  assert.strictEqual(api._writes.length, 0, 'must not write config when peerId is null');
});

test('identity - link_identity: missing name returns { ok: false, error } without writing config', async () => {
  const { createLinkIdentityHandler } = requireIdentity();
  const api = makeMockApi();
  const handler = createLinkIdentityHandler(api);

  const result = await handler({ name: undefined, peerId: '+15551234567' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error, 'must include error message');
  assert.strictEqual(api._writes.length, 0, 'must not write config when name is missing');
});

// ── resolveCallbackNumber ───────────────────────────────────────────────────

test('identity - resolveCallbackNumber: returns phone from plugin config', () => {
  const { resolveCallbackNumber } = requireIdentity();
  const pluginConfig = { identityLinks: { operator: ['sip-voice:+15551234567'] } };
  const result = resolveCallbackNumber(pluginConfig, {}, 'operator');
  assert.strictEqual(result, '+15551234567');
});

test('identity - resolveCallbackNumber: returns phone from session config when not in plugin config', () => {
  const { resolveCallbackNumber } = requireIdentity();
  const ocConfig = { session: { identityLinks: { hue: ['sip-voice:+15559876543'] } } };
  const result = resolveCallbackNumber({}, ocConfig, 'hue');
  assert.strictEqual(result, '+15559876543');
});

test('identity - resolveCallbackNumber: plugin config takes precedence over session config', () => {
  const { resolveCallbackNumber } = requireIdentity();
  const pluginConfig = { identityLinks: { operator: ['sip-voice:+11111111111'] } };
  const ocConfig = { session: { identityLinks: { operator: ['sip-voice:+22222222222'] } } };
  const result = resolveCallbackNumber(pluginConfig, ocConfig, 'operator');
  assert.strictEqual(result, '+11111111111');
});

test('identity - resolveCallbackNumber: identity with no sip-voice entry returns null', () => {
  const { resolveCallbackNumber } = requireIdentity();
  const pluginConfig = { identityLinks: { operator: ['discord:operatorhandle'] } };
  const ocConfig = { session: { identityLinks: { operator: ['telegram:@operator'] } } };
  const result = resolveCallbackNumber(pluginConfig, ocConfig, 'operator');
  assert.strictEqual(result, null);
});

test('identity - resolveCallbackNumber: unknown identity returns null', () => {
  const { resolveCallbackNumber } = requireIdentity();
  const pluginConfig = { identityLinks: { operator: ['sip-voice:+15551234567'] } };
  const result = resolveCallbackNumber(pluginConfig, {}, 'unknown');
  assert.strictEqual(result, null);
});

test('identity - resolveCallbackNumber: empty/missing identityLinks returns null', () => {
  const { resolveCallbackNumber } = requireIdentity();
  assert.strictEqual(resolveCallbackNumber(null, null, 'operator'), null);
  assert.strictEqual(resolveCallbackNumber({}, {}, 'operator'), null);
  assert.strictEqual(resolveCallbackNumber({ identityLinks: {} }, { session: { identityLinks: {} } }, 'operator'), null);
});

// ── resolveUserChannels ────────────────────────────────────────────────────────

test('identity - resolveUserChannels (4.1): identity with discord and telegram channels returns both from plugin config', () => {
  const { resolveUserChannels } = requireIdentity();
  const pluginConfig = { identityLinks: { hue: ['sip-voice:15551234567', 'discord:987654321', 'telegram:@hue'] } };
  const result = resolveUserChannels(pluginConfig, {}, 'hue');
  assert.deepStrictEqual(result, ['discord:987654321', 'telegram:@hue']);
});

test('identity - resolveUserChannels (4.2): identity with discord channel in session config (dynamic enrollment) returns it', () => {
  const { resolveUserChannels } = requireIdentity();
  const ocConfig = { session: { identityLinks: { hue: ['sip-voice:15551234567', 'discord:987654321'] } } };
  const result = resolveUserChannels({}, ocConfig, 'hue');
  assert.deepStrictEqual(result, ['discord:987654321']);
});

test('identity - resolveUserChannels (4.3): plugin config channels take precedence — session config channels are ignored', () => {
  const { resolveUserChannels } = requireIdentity();
  const pluginConfig = { identityLinks: { hue: ['sip-voice:15551234567', 'discord:plugin-channel'] } };
  const ocConfig = { session: { identityLinks: { hue: ['sip-voice:15551234567', 'discord:session-channel'] } } };
  const result = resolveUserChannels(pluginConfig, ocConfig, 'hue');
  assert.deepStrictEqual(result, ['discord:plugin-channel']);
});

test('identity - resolveUserChannels (4.4): identity with only sip-voice entries returns empty array', () => {
  const { resolveUserChannels } = requireIdentity();
  const pluginConfig = { identityLinks: { hue: ['sip-voice:15551234567'] } };
  const result = resolveUserChannels(pluginConfig, {}, 'hue');
  assert.deepStrictEqual(result, []);
});

test('identity - resolveUserChannels (4.5): unknown identity returns empty array', () => {
  const { resolveUserChannels } = requireIdentity();
  const pluginConfig = { identityLinks: { hue: ['sip-voice:15551234567', 'discord:987654321'] } };
  const result = resolveUserChannels(pluginConfig, {}, 'alice');
  assert.deepStrictEqual(result, []);
});

test('identity - resolveUserChannels (4.6): empty/missing identityLinks returns empty array', () => {
  const { resolveUserChannels } = requireIdentity();
  assert.deepStrictEqual(resolveUserChannels(null, null, 'hue'), []);
  assert.deepStrictEqual(resolveUserChannels({}, {}, 'hue'), []);
  assert.deepStrictEqual(resolveUserChannels({ identityLinks: {} }, { session: { identityLinks: {} } }, 'hue'), []);
});

test('identity - resolveUserChannels (4.7): mixed sip-voice and non-sip-voice entries — only non-sip-voice returned', () => {
  const { resolveUserChannels } = requireIdentity();
  const pluginConfig = { identityLinks: { hue: ['sip-voice:15551234567', 'discord:987654321', 'sip-voice:15559999999', 'telegram:@hue'] } };
  const result = resolveUserChannels(pluginConfig, {}, 'hue');
  assert.deepStrictEqual(result, ['discord:987654321', 'telegram:@hue']);
});

test('identity - link_identity: concurrent enrollments are serialized by mutex', async () => {
  const { createLinkIdentityHandler } = requireIdentity();

  const writeLog = [];
  let callCount = 0;

  // Simulate slow async write for the first call only
  const api = {
    config: { session: {} },
    runtime: {
      config: {
        writeConfigFile: async () => {
          callCount++;
          const n = callCount;
          writeLog.push(`start-${n}`);
          if (n === 1) {
            await new Promise((res) => setTimeout(res, 20));
          }
          writeLog.push(`end-${n}`);
        },
      },
    },
  };

  const handler = createLinkIdentityHandler(api);

  // Fire two concurrent enrollments
  await Promise.all([
    handler({ name: 'alice', peerId: '11111111111' }),
    handler({ name: 'bob', peerId: '22222222222' }),
  ]);

  // Serialized: start-1, end-1, start-2, end-2 (NOT start-1, start-2, ...)
  assert.deepStrictEqual(
    writeLog,
    ['start-1', 'end-1', 'start-2', 'end-2'],
    'Concurrent writes must be serialized — mutex must prevent interleaving'
  );
});

'use strict';

const logger = require('./logger');

/**
 * Resolve a peerId (phone number) to a canonical identity name
 * by scanning session.identityLinks in the OpenClaw config.
 *
 * @param {object} config - Full OpenClaw config (api.config)
 * @param {string} peerId - Caller phone number
 * @returns {{ isFirstCall: boolean, identity: string|null }}
 */
function resolveIdentity(config, peerId) {
  const links = (config && config.session && config.session.identityLinks) || {};

  // Normalize peerId for comparison — strip leading '+'
  const normalizedPeer = peerId ? peerId.replace(/^\+/, '') : '';

  for (const [name, channels] of Object.entries(links)) {
    if (!Array.isArray(channels)) continue;
    for (const ch of channels) {
      if (!ch.startsWith('sip-voice:')) continue;
      const linked = ch.slice('sip-voice:'.length).replace(/^\+/, '');
      if (linked === normalizedPeer) {
        logger.debug('identity resolved', { identity: name });
        return { isFirstCall: false, identity: name };
      }
    }
  }

  logger.debug('no identity match — first call');
  return { isFirstCall: true, identity: null };
}

// ---------------------------------------------------------------------------
// link_identity tool handler factory
//
// Creates the handler for the link_identity agent tool with a promise-chain
// mutex to serialize concurrent config writes and prevent corruption.
// ---------------------------------------------------------------------------

// Module-level mutex queue — intentionally persists for the lifetime of the process.
// If the plugin is hot-reloaded without a process restart, the module cache is retained
// and this queue carries over (already resolved, so harmless). Tests bust the cache via
// requireIdentity() to get a fresh queue per test.
let _enrollmentQueue = Promise.resolve();

function enrollmentMutex(fn) {
  _enrollmentQueue = _enrollmentQueue.then(fn, fn);
  return _enrollmentQueue;
}

/**
 * Creates the link_identity tool handler bound to the given api.
 *
 * @param {{ config: object, runtime: { config: { writeConfigFile: Function } } }} api
 * @returns {Function} async ({ name, channels, peerId }) => { ok, identity } | { ok, error }
 */
function createLinkIdentityHandler(api) {
  return async ({ name, channels, peerId } = {}) => {
    if (!name || !peerId) {
      return { ok: false, error: 'name and peerId are required' };
    }
    return enrollmentMutex(async () => {
      const cfg = api.config;
      cfg.session = cfg.session || {};
      cfg.session.identityLinks = cfg.session.identityLinks || {};

      // Store without leading '+' — consistent with outbound-client convention
      const sipChannel = `sip-voice:${peerId.replace(/^\+/, '')}`;

      // Save prior entry for rollback — AC 6: if write fails, in-memory config must
      // remain unchanged so resolveIdentity() does not return a phantom enrollment.
      const prevEntry = cfg.session.identityLinks[name];
      cfg.session.identityLinks[name] = [sipChannel, ...(channels || [])];

      try {
        await api.runtime.config.writeConfigFile(cfg);
        logger.info('identity enrolled', { name, channelCount: (channels || []).length + 1 });
        return { ok: true, identity: name };
      } catch (err) {
        // Rollback in-memory mutation so caller is not phantom-enrolled this session.
        if (prevEntry === undefined) {
          delete cfg.session.identityLinks[name];
        } else {
          cfg.session.identityLinks[name] = prevEntry;
        }
        logger.error('identity enrollment failed', { name, error: err.message });
        return { ok: false, error: err.message };
      }
    });
  };
}

/**
 * Resolve an identity name to a callback phone number for outbound calls.
 * Checks plugin config first (operator-defined), then session config (dynamic enrollment).
 * @param {object} pluginConfig - Plugin config (api.pluginConfig)
 * @param {object} ocConfig - Full OpenClaw config (for session.identityLinks)
 * @param {string} identityName - Canonical identity name (e.g., "operator", "hue")
 * @returns {string|null} Phone number (e.g., "+15551234567") or null if not found
 */
function resolveCallbackNumber(pluginConfig, ocConfig, identityName) {
  // Check plugin config first (operator-defined takes precedence)
  const pluginLinks = (pluginConfig && pluginConfig.identityLinks) || {};
  const pluginChannels = pluginLinks[identityName];
  if (Array.isArray(pluginChannels)) {
    for (const ch of pluginChannels) {
      if (ch.startsWith('sip-voice:')) {
        return ch.slice('sip-voice:'.length);
      }
    }
  }

  // Fall back to session config (dynamically enrolled)
  const sessionLinks = (ocConfig && ocConfig.session && ocConfig.session.identityLinks) || {};
  const sessionChannels = sessionLinks[identityName];
  if (Array.isArray(sessionChannels)) {
    for (const ch of sessionChannels) {
      if (ch.startsWith('sip-voice:')) {
        return ch.slice('sip-voice:'.length);
      }
    }
  }

  return null;
}

/**
 * Resolve all non-SIP text channels linked to an identity.
 * Checks plugin config first (operator-defined), then session config (dynamic enrollment).
 * @param {object} pluginConfig - Plugin config (api.pluginConfig)
 * @param {object} ocConfig - Full OpenClaw config (for session.identityLinks)
 * @param {string} identityName - Canonical identity name (e.g., "hue")
 * @returns {string[]} Array of channel strings (e.g., ["discord:987654321"]) — empty if none
 */
function resolveUserChannels(pluginConfig, ocConfig, identityName) {
  if (!identityName) return [];

  // Check plugin config first (operator-defined takes precedence)
  const pluginLinks = (pluginConfig && pluginConfig.identityLinks) || {};
  const pluginChannels = pluginLinks[identityName];
  if (Array.isArray(pluginChannels)) {
    const textChannels = pluginChannels.filter(ch => !ch.startsWith('sip-voice:'));
    if (textChannels.length > 0) return textChannels;
  }

  // Fall back to session config (dynamically enrolled)
  const sessionLinks = (ocConfig && ocConfig.session && ocConfig.session.identityLinks) || {};
  const sessionChannels = sessionLinks[identityName];
  if (Array.isArray(sessionChannels)) {
    const textChannels = sessionChannels.filter(ch => !ch.startsWith('sip-voice:'));
    if (textChannels.length > 0) return textChannels;
  }

  return [];
}

module.exports = { resolveIdentity, createLinkIdentityHandler, resolveCallbackNumber, resolveUserChannels };

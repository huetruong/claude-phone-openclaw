'use strict';

// In-memory Map keyed by callId (drachtio callUuid — UUID v4, lowercase, hyphenated).
// No persistence: matches OpenClaw bug #3290 constraint (chatRunState cleared on restart).
// clear() is called on plugin startup to reap stale sessions from prior gateway runs.

const store = new Map();

function create(callId, sessionId) {
  store.set(callId, sessionId);
}

function get(callId) {
  return store.get(callId);
}

function remove(callId) {
  store.delete(callId);
}

function clear() {
  store.clear();
}

function size() {
  return store.size;
}

module.exports = { create, get, remove, clear, size };

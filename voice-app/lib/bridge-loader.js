'use strict';

/**
 * Bridge loader — reads BRIDGE_TYPE env var and returns the appropriate bridge module.
 * Extracted for testability; called once at startup from index.js.
 */
function loadBridge() {
  var bridgeType = process.env.BRIDGE_TYPE || 'claude';
  if (bridgeType !== 'claude' && bridgeType !== 'openclaw') {
    throw new Error('[BRIDGE] Invalid BRIDGE_TYPE: ' + bridgeType + '. Must be "claude" or "openclaw".');
  }
  console.log('[BRIDGE] Using ' + bridgeType + ' bridge');
  return require('./' + bridgeType + '-bridge');
}

module.exports = { loadBridge };

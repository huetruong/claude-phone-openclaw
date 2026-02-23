'use strict';

const logger = require('./logger');

let pluginConfig = {};

async function activate(api) {
  pluginConfig = api.getConfig() || {};

  api.registerChannel({
    id: 'sip-voice',
    name: 'SIP Voice',
    description: 'SIP telephone channel for OpenClaw agents'
  });

  const accounts = pluginConfig.accounts || [];
  const bindings = pluginConfig.bindings || [];
  logger.info('channel registered', {
    accounts: accounts.length,
    bindings: bindings.length
  });
}

function getConfig() {
  return pluginConfig;
}

module.exports = { activate, getConfig };

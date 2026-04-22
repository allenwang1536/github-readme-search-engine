// @ts-check
/**
 * @typedef {import("../types.js").Config} Config
 */
const createService = require('./service.js');

/**
 * @param {Config} config
 */
function mem(config) {
  return createService(config, 'mem');
}

module.exports = mem;

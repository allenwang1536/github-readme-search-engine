// @ts-check
/**
 * @typedef {import("../types.js").Config} Config
 */
const createService = require('./service.js');

/**
 * @param {Config} config
 */
function store(config) {
  return createService(config, 'store');
}

module.exports = store;

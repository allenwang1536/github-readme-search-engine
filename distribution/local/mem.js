// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 *
 * @typedef {Object} StoreConfig
 * @property {string | null} key
 * @property {string | null} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 */


// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 *
 * @typedef {Object} StoreConfig
 * @property {?string} key
 * @property {?string} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 */

/** @type {Object.<string, Object.<string, any>>} */
const buckets = {};

/**
 * @param {SimpleConfig} configuration
 * @returns {{gid: string, key: string | null}}
 */
function parseConfig(configuration) {
  if (configuration && typeof configuration === 'object') {
    return {
      gid: configuration.gid || 'local',
      key: typeof configuration.key === 'string' ? configuration.key : null,
    };
  }
  return { gid: 'local', key: typeof configuration === 'string' ? configuration : null };
}

/**
 * @param {string} gid
 */
function ensureBucket(gid) {
  buckets[gid] = buckets[gid] || {};
  return buckets[gid];
}

/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function put(state, configuration, callback) {
  const cfg = parseConfig(configuration);
  const key = cfg.key === null ? globalThis.distribution.util.id.getID(state) : cfg.key;
  const bucket = ensureBucket(cfg.gid);

  bucket[key] = state;
  return callback(null, state);
};

/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function append(state, configuration, callback) {
  const cfg = parseConfig(configuration);
  const key = cfg.key === null ? globalThis.distribution.util.id.getID(state) : cfg.key;
  const bucket = ensureBucket(cfg.gid);

  if (!(key in bucket)) {
    bucket[key] = [state];
    return callback(null, bucket[key]);
  }

  if (Array.isArray(bucket[key])) {
    bucket[key].push(state);
    return callback(null, bucket[key]);
  }

  bucket[key] = [bucket[key], state];
  return callback(null, bucket[key]);
};

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function get(configuration, callback) {
  const cfg = parseConfig(configuration);
  const bucket = ensureBucket(cfg.gid);

  if (cfg.key === null) {
    return callback(null, Object.keys(bucket));
  }

  if (!(cfg.key in bucket)) {
    return callback(new Error('Key not found'));
  }

  return callback(null, bucket[cfg.key]);
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function del(configuration, callback) {
  const cfg = parseConfig(configuration);
  const bucket = ensureBucket(cfg.gid);

  if (cfg.key === null || !(cfg.key in bucket)) {
    return callback(new Error('Key not found'));
  }

  const value = bucket[cfg.key];
  delete bucket[cfg.key];
  return callback(null, value);
};

module.exports = { put, get, del, append };

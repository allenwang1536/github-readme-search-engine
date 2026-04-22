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

/* Notes/Tips:

- Use absolute paths to make sure they are agnostic to where your code is running from!
  Use the `path` module for that.
*/

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * @param {SimpleConfig} configuration
 * @returns {{gid: string, key: string | null}}
 */
function parseConfig(configuration) {
  if (configuration && typeof configuration === 'object') {
    return {
      gid: configuration.gid || 'local',
      key: Object.prototype.hasOwnProperty.call(configuration, 'key') && typeof configuration.key === 'string' ? configuration.key : null,
    };
  }

  return {
    gid: 'local',
    key: typeof configuration === 'string' ? configuration : null,
  };
}

const MAX_FILENAME = 250;

/**
 * Convert an arbitrary key string into a filesystem-safe filename.
 * Short keys use reversible hex encoding; long keys use a SHA-256 hash
 * prefixed with 'H' (companion .key file stores the original key).
 * @param {string} key
 */
function keyToFileName(key) {
  const hex = Buffer.from(key, 'utf8').toString('hex');
  if (hex.length <= MAX_FILENAME) return hex;
  return 'H' + crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Check if a filename is a hashed (long) key.
 * @param {string} fileName
 */
function isHashedFileName(fileName) {
  return fileName.startsWith('H') && fileName.length === 65;
}

/**
 * Convert an encoded filename back to the original key string.
 * Returns null for hashed filenames (caller must read .key file).
 * @param {string} fileName
 * @returns {string | null}
 */
function fileNameToKey(fileName) {
  if (isHashedFileName(fileName)) return null;
  return Buffer.from(fileName, 'hex').toString('utf8');
}

/**
 * @param {string} gid
 */
function baseDir(gid) {
  const sid = globalThis.distribution.util.id.getSID(globalThis.distribution.node.config);
  const dir = path.resolve(__dirname, '../../store', sid, gid);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} gid
 * @param {string} key
 */
function keyPath(gid, key) {
  return path.join(baseDir(gid), keyToFileName(key));
}


/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function put(state, configuration, callback) {
  const cfg = parseConfig(configuration);
  const key = cfg.key === null ? globalThis.distribution.util.id.getID(state) : cfg.key;
  const file = keyPath(cfg.gid, key);
  const fileName = keyToFileName(key);

  fs.writeFile(file, globalThis.distribution.util.serialize(state), (error) => {
    if (error) return callback(error);
    // For hashed filenames, store original key in companion .key file
    if (isHashedFileName(fileName)) {
      const keyFile = file + '.key';
      return fs.writeFile(keyFile, key, (keyErr) => {
        if (keyErr) return callback(keyErr);
        return callback(null, state);
      });
    }
    return callback(null, state);
  });
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function get(configuration, callback) {
  const cfg = parseConfig(configuration);

  if (cfg.key === null) {
    return fs.readdir(baseDir(cfg.gid), (error, files) => {
      if (error) return callback(error);
      // Filter out companion .key files
      const dataFiles = files.filter((f) => !f.endsWith('.key'));
      // Resolve keys: hex-decode short names, read .key file for hashed names
      const keys = [];
      let pending = dataFiles.length;
      if (pending === 0) return callback(null, keys);

      dataFiles.forEach((file) => {
        const decoded = fileNameToKey(file);
        if (decoded !== null) {
          keys.push(decoded);
          if (--pending === 0) return callback(null, keys);
        } else {
          // Hashed filename — read companion .key file
          const keyFile = path.join(baseDir(cfg.gid), file + '.key');
          fs.readFile(keyFile, 'utf8', (readErr, originalKey) => {
            if (readErr) {
              // .key file missing — use hash as key
              keys.push(file);
            } else {
              keys.push(originalKey);
            }
            if (--pending === 0) return callback(null, keys);
          });
        }
      });
    });
  }

  return fs.readFile(keyPath(cfg.gid, cfg.key), 'utf8', (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') return callback(new Error('Key not found'));
      return callback(error);
    }

    try {
      return callback(null, globalThis.distribution.util.deserialize(data));
    } catch (e) {
      return callback(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function del(configuration, callback) {
  const cfg = parseConfig(configuration);

  if (cfg.key === null) {
    return callback(new Error('Key not found'));
  }

  const file = keyPath(cfg.gid, cfg.key);
  const fileName = keyToFileName(cfg.key);
  return fs.readFile(file, 'utf8', (readError, data) => {
    if (readError) {
      if (readError.code === 'ENOENT') return callback(new Error('Key not found'));
      return callback(readError);
    }

    fs.unlink(file, (delError) => {
      if (delError) return callback(delError);
      // Also remove companion .key file if it exists
      if (isHashedFileName(fileName)) {
        fs.unlink(file + '.key', () => {
          // Ignore error — .key file may not exist
          try {
            return callback(null, globalThis.distribution.util.deserialize(data));
          } catch (e) {
            return callback(e instanceof Error ? e : new Error(String(e)));
          }
        });
        return;
      }
      try {
        return callback(null, globalThis.distribution.util.deserialize(data));
      } catch (e) {
        return callback(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function append(state, configuration, callback) {
  const cfg = parseConfig(configuration);
  const key = cfg.key === null ? globalThis.distribution.util.id.getID(state) : cfg.key;

  return get({ gid: cfg.gid, key }, (error, current) => {
    if (error) {
      if (error.message === 'Key not found') {
        return put([state], { gid: cfg.gid, key }, callback);
      }
      return callback(error);
    }

    const next = Array.isArray(current) ? [...current, state] : [current, state];
    return put(next, { gid: cfg.gid, key }, callback);
  });
}

module.exports = { put, get, del, append };

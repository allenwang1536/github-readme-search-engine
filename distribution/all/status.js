// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../util/id.js").Node} Node
 *
 * @typedef {Object} Status
 * @property {(configuration: string, callback: Callback) => void} get
 * @property {(configuration: Node, callback: Callback) => void} spawn
 * @property {(callback: Callback) => void} stop
 */

/**
 * @param {Config} config
 * @returns {Status}
 */
function status(config) {
  const context = {};
  context.gid = config.gid || 'all';

  /**
   * @param {string} configuration
   * @param {Callback} callback
   */
  function get(configuration, callback) {
    const remote = { service: 'status', method: 'get' };
    globalThis.distribution[context.gid].comm.send([configuration], remote, (e, v) => {
      if (configuration === 'heapTotal' || configuration === 'heapUsed') {
        const sum = Object.values(v || {}).reduce((acc, n) => acc + Number(n || 0), 0);
        return callback(e, sum);
      }
      callback(e, v);
    });
  }

  /**
   * @param {Node} configuration
   * @param {Callback} callback
   */
  function spawn(configuration, callback) {
    globalThis.distribution.local.status.spawn(configuration, (e, v) => {
      if (e) return callback(e);
      globalThis.distribution.local.groups.add(context.gid, configuration, (e2) => {
        callback(e2 || null, v || configuration);
      });
    });
  }

  /**
   * @param {Callback} callback
   */
  function stop(callback) {
    globalThis.distribution.local.groups.get(context.gid, (e, group) => {
      if (e) return callback(e);
      const localSid = globalThis.distribution.util.id.getSID(globalThis.distribution.node.config);
      const targets = Object.entries(group || {}).filter(([sid]) => sid !== localSid);
      if (targets.length === 0) return callback({}, {});

      /** @type {Object.<string, Error>} */
      const errors = {};
      const values = {};
      let remaining = targets.length;
      targets.forEach(([sid, node]) => {
        globalThis.distribution.local.comm.send([], { node, service: 'status', method: 'stop' }, (err, val) => {
          if (err) errors[sid] = err;
          else values[sid] = val;
          remaining--;
          if (remaining === 0) callback(errors, values);
        });
      });
    });
  }

  return { get, stop, spawn };
}

module.exports = status;

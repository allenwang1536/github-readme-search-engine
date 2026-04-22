// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 */

/**
 * NOTE: This Target is slightly different from local.all.Target
 * @typedef {Object} Target
 * @property {string} service
 * @property {string} method
 * @property {string} [gid]
 *
 * @typedef {Object} Comm
 * @property {(message: any[], configuration: Target, callback: Callback) => void} send
 */

/**
 * @param {Config} config
 * @returns {Comm}
 */
function comm(config) {
  const context = {};
  context.gid = config.gid || 'all';

  /**
   * @param {any[]} message
   * @param {Target} configuration
   * @param {Callback} callback
   */
  function send(message, configuration, callback) {
    callback = callback || function () { };
    globalThis.distribution.local.groups.get(context.gid, (groupErr, group) => {
      if (groupErr) return callback(groupErr);
      const entries = Object.entries(group || {});
      if (entries.length === 0) return callback(new Error(`Group is empty: ${context.gid}`));

      const errors = {};
      const values = {};
      let remaining = entries.length;

      entries.forEach(([sid, node]) => {
        const remote = {
          node,
          gid: configuration && configuration.gid ? configuration.gid : 'local',
          service: configuration && configuration.service,
          method: configuration && configuration.method,
        };

        globalThis.distribution.local.comm.send(message, remote, (e, v) => {
          if (e) errors[sid] = e;
          else values[sid] = v;

          remaining--;
          if (remaining === 0) callback(errors, values);
        });
      });
    });
  }

  return { send };
}

module.exports = comm;

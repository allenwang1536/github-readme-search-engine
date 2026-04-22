// @ts-check
/**
 * @typedef {import("../types").Callback} Callback
 * @typedef {import("../types").Node} Node
 *
 * @typedef {Object} Payload
 * @property {{service: string, method: string, node: Node}} remote
 * @property {any} message
 * @property {string} mid
 * @property {string} gid
 */

const N = 10;
const seen = new Set();


/**
 * @param {Payload} payload
 * @param {Callback} callback
 */
function recv(payload, callback) {
  callback = callback || function () { };
  if (!payload || !payload.mid) return callback(new Error('Invalid gossip payload'));
  if (seen.has(payload.mid)) return callback(null, null);
  seen.add(payload.mid);

  globalThis.distribution.local.routes.get(
    { service: payload.remote.service, gid: 'local' },
    (e, service) => {
      if (e || !service || typeof service[payload.remote.method] !== 'function') {
        return callback(e || new Error('Invalid gossip remote'));
      }
      const method = service[payload.remote.method];
      const normalize = globalThis.distribution.util.normalize;
      const args = normalize(method, payload.message || []);
      method(...args, () => {
        const g = globalThis.distribution[payload.gid];
        if (!g || !g.gossip) return callback(null, null);
        g.gossip.send(payload.message, payload.remote, () => callback(null, null), payload.mid);
      });
    },
  );
}

module.exports = { recv };

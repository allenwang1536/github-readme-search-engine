// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").SID} SID
 * @typedef {import("../types.js").Node} Node
 *
 * @typedef {Object} Remote
 * @property {Node} node
 * @property {string} service
 * @property {string} method

 * @typedef {Object} Payload
 * @property {Remote} remote
 * @property {any} message
 * @property {string} mid
 * @property {string} gid
 *
 *
 * @typedef {Object} Gossip
 * @property {(payload: Payload, remote: Remote, callback: Callback) => void} send
 * @property {(perod: number, func: () => void, callback: Callback) => void} at
 * @property {(intervalID: NodeJS.Timeout, callback: Callback) => void} del
 */


/**
 * @param {Config} config
 * @returns {Gossip}
 */
function gossip(config) {
  const context = {};
  context.gid = config.gid || 'all';
  context.subset = config.subset || function (lst) {
    return Math.ceil(Math.log(lst.length));
  };
  const timers = {};

  /**
   * @param {Payload} payload
   * @param {Remote} remote
   * @param {Callback} callback
   */
  function send(payload, remote, callback) {
    const message = payload;
    callback = callback || function () { };
    const forwardedMid = arguments[3];

    globalThis.distribution.local.groups.get(context.gid, (e, group) => {
      if (e) return callback(e);
      const entries = Object.entries(group || {});
      if (entries.length === 0) return callback(new Error(`Group is empty: ${context.gid}`));

      const localSid = globalThis.distribution.util.id.getSID(globalThis.distribution.node.config);
      const peers = entries.filter(([sid]) => sid !== localSid);
      if (peers.length === 0) return callback({}, {});

      const shuffled = peers.slice().sort(() => Math.random() - 0.5);
      const k = Math.max(1, Math.min(peers.length, Number(context.subset(peers.map(([sid]) => sid))) || 1));
      const targets = shuffled.slice(0, k);

      const mid = forwardedMid || globalThis.distribution.util.id.getMID({ gid: context.gid, remote, message });
      const gossipPayload = { gid: context.gid, remote, message, mid };

      const errors = {};
      const values = {};
      let remaining = targets.length;

      targets.forEach(([sid, node]) => {
        globalThis.distribution.local.comm.send(
          [gossipPayload],
          { node, service: 'gossip', method: 'recv' },
          (err, val) => {
            if (err) errors[sid] = err;
            else values[sid] = val;
            remaining--;
            if (remaining === 0) callback(errors, values);
          },
        );
      });
    });
  }

  /**
   * @param {number} period
   * @param {() => void} func
   * @param {Callback} callback
   */
  function at(period, func, callback) {
    const intervalID = setInterval(func, period);
    const id = globalThis.distribution.util.id.getMID({ gid: context.gid, period });
    timers[id] = intervalID;
    callback(null, id);
  }

  /**
   * @param {NodeJS.Timeout} intervalID
   * @param {Callback} callback
   */
  function del(intervalID, callback) {
    const id = intervalID;
    if (timers[id]) {
      clearInterval(timers[id]);
      delete timers[id];
    }
    callback(null, id);
  }

  return { send, at, del };
}

module.exports = gossip;

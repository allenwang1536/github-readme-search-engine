// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Node} Node
 * @typedef {import("../types.js").Hasher} Hasher
 */
const log = require('../util/log.js');
const crypto = require('crypto');

// Map from remote function IDs to local function pointers
const toLocal = {};

/**
 * Generate a unique ID for an RPC function
 * @returns {string}
 */
function generateRPCId() {
  const randomData = crypto.randomBytes(32).toString('hex') + Date.now();
  return crypto.createHash('sha256').update(randomData).digest('hex');
}

/**
 * @param {Function} func
 * @returns {Function} func
 */
function createRPC(func) {
  // Generate a unique ID for this function
  const funcId = generateRPCId();

  // Store the function in the local map
  toLocal[funcId] = func;

  // Get the current node configuration - this is where the function lives
  const node = globalThis.distribution.node.config;
  const nodeInfo = JSON.stringify({ ip: node.ip, port: node.port });

  // Create the RPC stub function as a string that will be serialized
  // When deserialized and called on a remote node, it will call back to this node
  const stubCode = `
    (function(...args) {
      const callback = args.pop() || function() {};
      const remote = {
        node: ${nodeInfo},
        service: "rpc",
        method: "call"
      };
      const message = ["${funcId}", ...args];
      globalThis.distribution.local.comm.send(message, remote, callback);
    })
  `;

  // Create the actual stub function
  // When called locally (on the same node), it calls the function directly
  // When serialized and called remotely, it uses the stub code above
  const stub = function (...args) {
    const callback = args.pop() || function () { };

    // Check if we're on the originating node
    const currentNode = globalThis.distribution.node.config;
    if (currentNode.ip === node.ip && currentNode.port === node.port) {
      // We're on the originating node - call the function directly
      const localFunc = toLocal[funcId];
      if (localFunc) {
        return localFunc(...args, callback);
      } else {
        return callback(new Error(`RPC function not found: ${funcId}`));
      }
    } else {
      // We're on a remote node - send a message back to the originating node
      const remote = {
        node: { ip: node.ip, port: node.port },
        service: 'rpc',
        method: 'call',
      };
      const message = [funcId, ...args];
      globalThis.distribution.local.comm.send(message, remote, callback);
    }
  };

  // Override toString to return the stub code for serialization
  // This is crucial - when the function is serialized, it will use this representation
  stub.toString = () => stubCode;

  return stub;
}

/**
 * RPC service call handler - called when a remote node invokes an RPC
 * @param {string} funcId - The unique ID of the function to call
 * @param {...any} args - Arguments to pass to the function (last one is callback)
 */
function call(funcId, ...args) {
  // Handle case where funcId is actually the callback (no args)
  if (typeof funcId === 'function') {
    const cb = /** @type {Function} */ (funcId);
    return cb(new Error('Function ID is required'));
  }

  const callback = args.pop() || function () { };

  const func = toLocal[funcId];
  if (!func) {
    return callback(new Error(`RPC function not found: ${funcId}`));
  }

  // Call the local function with the provided arguments
  try {
    func(...args, callback);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * The toAsync function transforms a synchronous function that returns a value into an asynchronous one,
 * which accepts a callback as its final argument and passes the value to the callback.
 * @param {Function} func
 */
function toAsync(func) {

  // It's the caller's responsibility to provide a callback
  const asyncFunc = (/** @type {any[]} */ ...args) => {
    const callback = args.pop();
    try {
      const result = func(...args);
      return callback(null, result);
    } catch (error) {
      return callback(error);
    }
  };

  /* Overwrite toString to return the original function's code.
   Otherwise, all functions passed through toAsync would have the same id. */
  asyncFunc.toString = () => func.toString();
  return asyncFunc;
}


module.exports = {
  createRPC,
  toAsync,
  call,
  toLocal,
};

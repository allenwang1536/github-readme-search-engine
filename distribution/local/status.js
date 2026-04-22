// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Node} Node
 */

const id = require('../util/id.js');
const { fork } = require('node:child_process');
const path = require('node:path');

// Message counter for tracking total messages processed
let messageCount = 0;

/**
 * Increment the message count
 */
function incrementCount() {
  messageCount++;
}

/**
 * @param {string} configuration
 * @param {Callback} callback
 */
function get(configuration, callback) {
  // Handle case where only callback is passed (configuration is the callback)
  if (typeof configuration === 'function') {
    callback = configuration;
    configuration = undefined;
  }

  // Ensure callback exists
  callback = callback || function () { };

  // Handle missing or invalid configuration
  if (configuration === undefined || configuration === null || typeof configuration !== 'string') {
    return callback(new Error('Status key is required'));
  }

  const config = globalThis.distribution.node.config;

  switch (configuration) {
    case 'nid':
      return callback(null, id.getNID(config));
    case 'sid':
      return callback(null, id.getSID(config));
    case 'ip':
      return callback(null, config.ip);
    case 'port':
      return callback(null, config.port);
    case 'counts':
      return callback(null, messageCount);
    case 'heapTotal':
      return callback(null, process.memoryUsage().heapTotal);
    case 'heapUsed':
      return callback(null, process.memoryUsage().heapUsed);
    default:
      return callback(new Error(`Status key not found: ${configuration}`));
  }
};


/**
 * @param {Node} configuration
 * @param {Callback} callback
 */
function spawn(configuration, callback) {
  // Handle case where only callback is passed
  if (typeof configuration === 'function') {
    callback = configuration;
    configuration = undefined;
  }

  // Ensure callback exists
  callback = callback || function () { };

  // Validate configuration
  if (!configuration) {
    return callback(new Error('Node configuration is required'));
  }

  if (!configuration.ip) {
    return callback(new Error('Node IP is required'));
  }

  if (!configuration.port) {
    return callback(new Error('Node port is required'));
  }

  // Path to the distribution.js entry point
  const distributionPath = path.resolve(__dirname, '../../distribution.js');

  // Serialize the configuration for passing to the child process
  const serialization = require('../util/serialization.js');
  const configString = serialization.serialize(configuration);

  // Fork a new process running distribution.js with the config
  const child = fork(distributionPath, ['--config', configString], {
    detached: true,
    stdio: 'ignore',
  });

  // Detach the child so it runs independently
  child.unref();

  // Wait a bit for the node to start, then verify it's running
  setTimeout(() => {
    // Try to communicate with the spawned node to verify it's up
    const comm = require('./comm.js');
    comm.send(['nid'], { node: configuration, service: 'status', method: 'get' }, (err, nid) => {
      if (err) {
        return callback(err);
      }
      return callback(null, configuration);
    });
  }, 100);
}

/**
 * @param {Callback} callback
 */
function stop(callback) {
  // Handle case where callback is not provided
  if (typeof callback !== 'function') {
    callback = function () { };
  }

  const server = globalThis.distribution.node.server;

  if (!server) {
    return callback(null, null);
  }

  // Call callback first, then close server after a short delay
  // This allows the response to be sent before the server shuts down
  callback(null, null);

  setImmediate(() => {
    server.close();
  });
}

module.exports = { get, spawn, stop, incrementCount };

// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Node} Node
 */

const http = require('node:http');
const serialization = require('../util/serialization.js');

/**
 * @typedef {Object} Target
 * @property {string} service
 * @property {string} method
 * @property {Node} node
 * @property {string} [gid]
 */

/**
 * @param {Array<any>} message
 * @param {Target} remote
 * @param {(error: Error | null, value?: any) => void} [callback]
 * @returns {void}
 */
function send(message, remote, callback) {
  // Ensure callback exists
  callback = callback || function () { };

  // Validate message is an array - convert undefined/null to empty array
  if (message === undefined || message === null) {
    message = [];
  }

  if (!Array.isArray(message)) {
    return callback(new Error('Message must be an array'));
  }

  // Validate remote object
  if (!remote) {
    return callback(new Error('Remote configuration is required'));
  }

  // Validate node exists and has required properties
  if (!remote.node) {
    return callback(new Error('Remote node is required'));
  }

  if (!remote.node.ip) {
    return callback(new Error('Remote node IP is required'));
  }

  if (!remote.node.port) {
    return callback(new Error('Remote node port is required'));
  }

  // Validate service and method
  if (!remote.service) {
    return callback(new Error('Remote service is required'));
  }

  if (!remote.method) {
    return callback(new Error('Remote method is required'));
  }

  // Default gid to 'local'
  const gid = remote.gid || 'local';

  // Build the path: /<gid>/<service>/<method>
  const path = `/${gid}/${remote.service}/${remote.method}`;

  // Serialize the message
  let serializedMessage;
  try {
    serializedMessage = serialization.serialize(message);
  } catch (error) {
    return callback(new Error(`Failed to serialize message: ${error}`));
  }

  // Configure the HTTP request
  const options = {
    hostname: remote.node.ip,
    port: remote.node.port,
    path: path,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(serializedMessage),
    },
  };

  // Create the HTTP request
  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        // Deserialize the response
        const result = serialization.deserialize(data);

        // The response should be [error, value]
        if (Array.isArray(result) && result.length === 2) {
          const [error, value] = result;
          if (error) {
            if (typeof error === 'object' && !(error instanceof Error) && !error.message) {
              return callback(error, value);
            }
            // Reconstruct the Error object if needed
            if (error instanceof Error) {
              return callback(error, null);
            } else if (typeof error === 'object' && error.message) {
              const err = new Error(error.message);
              return callback(err, null);
            } else {
              return callback(new Error(String(error)), null);
            }
          }
          return callback(null, value);
        } else {
          // Unexpected response format
          return callback(new Error('Invalid response format from remote node'));
        }
      } catch (error) {
        return callback(new Error(`Failed to deserialize response: ${error}`));
      }
    });
  });

  // Handle request errors
  req.on('error', (error) => {
    return callback(error instanceof Error ? error : new Error(String(error)));
  });

  // Send the serialized message
  req.write(serializedMessage);
  req.end();
}

module.exports = { send };

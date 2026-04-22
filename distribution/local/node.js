// @ts-check
/**
 * @typedef {import("../types.js").Node} Node
 * @typedef {import("../types.js").Callback} Callback
 */
const http = require('node:http');
const url = require('node:url');
const log = require('../util/log.js');

const yargs = require('yargs/yargs');

/**
 * @returns {Node}
 */
function setNodeConfig() {
  const args = yargs(process.argv)
    .help(false)
    .version(false)
    .parse();

  let maybeIp; let maybePort; let maybeOnStart;
  if (typeof args.ip === 'string') {
    maybeIp = args.ip;
  }
  if (typeof args.port === 'string' || typeof args.port === 'number') {
    maybePort = parseInt(String(args.port), 10);
  }

  if (args.help === true || args.h === true) {
    console.log('Node usage:');
    console.log('  --ip <ip address>      The ip address to bind the node to');
    console.log('  --port <port>          The port to bind the node to');
    console.log('  --config <config>      The serialized config string');
    process.exit(0);
  }

  if (typeof args.config === 'string') {
    let config = undefined;
    try {
      config = globalThis.distribution.util.deserialize(args.config);
    } catch (error) {
      try {
        config = JSON.parse(args.config);
      } catch {
        console.error('Cannot deserialize config string: ' + args.config);
        process.exit(1);
      }
    }

    if (typeof config?.ip === 'string') {
      maybeIp = config?.ip;
    }
    if (typeof config?.port === 'number') {
      maybePort = config?.port;
    }
    if (typeof config?.onStart === 'function') {
      maybeOnStart = config?.onStart;
    }
  }

  // Default values for config
  maybeIp = maybeIp ?? '127.0.0.1';
  maybePort = maybePort ?? 1234;

  return {
    ip: maybeIp,
    port: maybePort,
    onStart: maybeOnStart,
  };
}
/*
    The start function will be called to start your node.
    It will take a callback as an argument.
    After your node has booted, you should call the callback.
*/


/**
 * @param {(err?: Error | null) => void} callback
 * @returns {void}
 */
function start(callback) {
  const serialization = require('../util/serialization.js');
  const routes = require('./routes.js');

  const server = http.createServer((req, res) => {
    /* Your server will be listening for PUT requests. */

    // Only accept PUT requests
    if (req.method !== 'PUT') {
      const errorResponse = serialization.serialize(
        new Error('Only PUT requests are supported'),
      );
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(errorResponse);
      return;
    }

    /*
      The path of the http request will determine the service to be used.
      The url will have the form: http://node_ip:node_port/gid/service/method
    */

    const parsedUrl = url.parse(req.url || '', true);
    const pathParts = (parsedUrl.pathname || '').split('/').filter((p) => p);

    // Expected format: /<gid>/<service>/<method>
    if (pathParts.length < 3) {
      const errorResponse = serialization.serialize(
        [new Error('Invalid path format. Expected: /<gid>/<service>/<method>'), null],
      );
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(errorResponse);
      return;
    }

    const [gid, serviceName, methodName] = pathParts;

    /*
      A common pattern in handling HTTP requests in Node.js is to have a
      subroutine that collects all the data chunks belonging to the same
      request. These chunks are aggregated into a body variable.

      When the req.on('end') event is emitted, it signifies that all data from
      the request has been received. Typically, this data is in the form of a
      string. To work with this data in a structured format, it is often parsed
      into a JSON object using JSON.parse(body), provided the data is in JSON
      format.

      Our nodes expect data in JSON format.
    */

    /** @type {any[]} */
    const body = [];

    req.on('data', (chunk) => {
      body.push(chunk);
    });

    req.on('end', () => {
      /*
        Here, you can handle the service requests.
        Use the local routes service to get the service you need to call.
        You need to call the service with the method and arguments provided in the request.
        Then, you need to serialize the result and send it back to the caller.
      */

      // Parse the request body
      let args = [];
      try {
        const bodyString = Buffer.concat(body).toString();
        if (bodyString) {
          args = serialization.deserialize(bodyString);
          if (!Array.isArray(args)) {
            args = [];
          }
        }
      } catch (error) {
        const errorResponse = serialization.serialize(
          [new Error(`Failed to parse request body: ${error}`), null],
        );
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(errorResponse);
        return;
      }

      // Increment message count for status.counts
      const status = require('./status.js');
      if (status.incrementCount) {
        status.incrementCount();
      }

      // Get the service using routes
      routes.get({ service: serviceName, gid: gid }, (err, service) => {
        if (err || !service) {
          const errorResponse = serialization.serialize(
            [err || new Error(`Service not found: ${serviceName}`), null],
          );
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(errorResponse);
          return;
        }

        // Get the method from the service
        const method = service[methodName];
        if (!method || typeof method !== 'function') {
          const errorResponse = serialization.serialize(
            [new Error(`Method not found: ${methodName} on service ${serviceName}`), null],
          );
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(errorResponse);
          return;
        }

        // Call the method with the arguments and a callback
        try {
          // Normalize args to fill in missing parameters with undefined
          const normalize = globalThis.distribution.util.normalize;
          const normalizedArgs = normalize(method, args);

          method(...normalizedArgs, (error, value) => {
            const response = serialization.serialize([error, value]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(response);
          });
        } catch (error) {
          const errorResponse = serialization.serialize(
            [error instanceof Error ? error : new Error(String(error)), null],
          );
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(errorResponse);
        }
      });
    });
  });

  /*
    Your server will be listening on the port and ip specified in the config
    You'll be calling the `callback` callback when your server has successfully
    started.

    At some point, we'll be adding the ability to stop a node
    remotely through the service interface.
  */

  // Important: allow tests to access server
  globalThis.distribution.node.server = server;
  const config = globalThis.distribution.node.config;

  server.once('listening', () => {
    callback(null);
  });

  server.once('error', (error) => {
    callback(error);
  });

  server.listen(config.port, config.ip);
}

module.exports = { start, config: setNodeConfig() };

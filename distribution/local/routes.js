/**
 * @typedef {import("../types").Callback} Callback
 * @typedef {string} ServiceName
 */

// Store for dynamically registered services
const serviceRegistry = {};

/**
 * @param {ServiceName | {service: ServiceName, gid?: string}} configuration
 * @param {Callback} callback
 * @returns {void}
 */
function get(configuration, callback) {
  // Ensure callback exists
  callback = callback || function () { };

  // Handle null/undefined configuration
  if (configuration == null) {
    return callback(new Error('Service name is required'));
  }

  // Extract service name from configuration
  let serviceName;
  let gid;

  if (typeof configuration === 'object') {
    serviceName = configuration.service;
    gid = configuration.gid;
  } else {
    serviceName = configuration;
  }

  // Handle null/undefined service name
  if (serviceName == null) {
    return callback(new Error('Service name is required'));
  }

  // If gid is 'local' or not specified, look up in local services
  if (!gid || gid === 'local') {
    // First check the dynamic service registry
    if (serviceRegistry[serviceName]) {
      return callback(null, serviceRegistry[serviceName]);
    }

    // Then check built-in local services
    const local = globalThis.distribution.local;
    if (local && local[serviceName]) {
      return callback(null, local[serviceName]);
    }

    return callback(new Error(`Service not found: ${serviceName}`));
  }

  // For other gids, look up in the appropriate group
  // This will be implemented in later milestones
  const groups = globalThis.distribution;
  if (groups && groups[gid] && groups[gid][serviceName]) {
    return callback(null, groups[gid][serviceName]);
  }

  return callback(new Error(`Service not found: ${serviceName} in group ${gid}`));
}

/**
 * @param {object} service
 * @param {string} configuration
 * @param {Callback} callback
 * @returns {void}
 */
function put(service, configuration, callback) {
  // Ensure callback exists
  callback = callback || function () { };

  // Store the service in the registry
  serviceRegistry[configuration] = service;

  return callback(null, configuration);
}

/**
 * @param {string} configuration
 * @param {Callback} callback
 */
function rem(configuration, callback) {
  // Ensure callback exists
  callback = callback || function () { };

  // Check if service exists
  if (!serviceRegistry[configuration]) {
    return callback(new Error(`Service not found: ${configuration}`));
  }

  // Remove and return the service
  const service = serviceRegistry[configuration];
  delete serviceRegistry[configuration];

  return callback(null, service);
}

module.exports = { get, put, rem };

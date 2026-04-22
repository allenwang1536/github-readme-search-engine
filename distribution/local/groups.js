// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").Node} Node
 */

const id = require('../util/id.js');

/**
 * Internal storage for group mappings: GID -> {SID -> Node}
 * @type {Object.<string, Object.<string, Node>>}
 */
const groups = {};

/**
 * Get the 'all' group, initializing it with the local node if needed
 * @returns {Object.<string, Node>}
 */
function getAllGroup() {
  if (!groups['all']) {
    groups['all'] = {};
  }
  // Always ensure local node is in the 'all' group
  const localNode = globalThis.distribution?.node?.config;
  if (localNode && localNode.ip && localNode.port) {
    const sid = id.getSID(localNode);
    groups['all'][sid] = localNode;
  }
  return groups['all'];
}

/**
 * @param {string} name
 * @param {Callback} callback
 */
function get(name, callback) {
  // Handle case where only callback is passed
  if (typeof name === 'function') {
    callback = name;
    return callback(new Error('Group name is required'));
  }

  callback = callback || function () { };

  if (!name || typeof name !== 'string') {
    return callback(new Error('Group name is required'));
  }

  // Special handling for 'all' group
  if (name === 'all') {
    return callback(null, { ...getAllGroup() });
  }

  const group = groups[name];
  if (!group) {
    return callback(new Error(`Group not found: ${name}`));
  }

  // Return a copy of the group to prevent external modification
  return callback(null, { ...group });
}

/**
 * @param {Config | string} config
 * @param {Object.<string, Node>} group
 * @param {Callback} callback
 */
function put(config, group, callback) {
  // Handle case where only callback is passed
  if (typeof config === 'function') {
    callback = config;
    return callback(new Error('Group config is required'));
  }

  // Handle case where group is the callback (only config passed)
  if (typeof group === 'function') {
    callback = group;
    return callback(new Error('Group nodes are required'));
  }

  callback = callback || function () { };

  // Extract gid from config (can be string or object with gid property)
  /** @type {string | undefined} */
  let gid;
  /** @type {Config} */
  let groupConfig;

  if (typeof config === 'string') {
    gid = config;
    groupConfig = { gid: config };
  } else if (config && typeof config === 'object') {
    gid = config.gid;
    groupConfig = config;
  } else {
    return callback(new Error('Group config is required'));
  }

  if (!gid || typeof gid !== 'string') {
    return callback(new Error('Group ID (gid) is required'));
  }

  // Store the group mapping (copy to prevent external modification)
  groups[gid] = { ...group };

  // Instantiate distribution[gid] with distributed services
  const { setup } = require('../all/all.js');
  globalThis.distribution[gid] = setup(groupConfig);

  return callback(null, groups[gid]);
}

/**
 * @param {string} name
 * @param {Callback} callback
 */
function del(name, callback) {
  // Handle case where only callback is passed
  if (typeof name === 'function') {
    callback = name;
    return callback(new Error('Group name is required'));
  }

  callback = callback || function () { };

  if (!name || typeof name !== 'string') {
    return callback(new Error('Group name is required'));
  }

  const group = groups[name];
  if (!group) {
    return callback(new Error(`Group not found: ${name}`));
  }

  // Delete the group mapping
  const deletedGroup = groups[name];
  delete groups[name];

  // Also remove from distribution object
  if (globalThis.distribution && globalThis.distribution[name]) {
    delete globalThis.distribution[name];
  }

  return callback(null, deletedGroup);
}

/**
 * @param {string} name
 * @param {Node} node
 * @param {Callback} callback
 */
function add(name, node, callback) {
  // Handle case where only callback is passed
  if (typeof name === 'function') {
    callback = name;
    return callback(new Error('Group name is required'));
  }

  // Handle case where node is the callback
  if (typeof node === 'function') {
    callback = node;
    return callback(new Error('Node is required'));
  }

  callback = callback || function () { };

  if (!name || typeof name !== 'string') {
    return callback(new Error('Group name is required'));
  }

  // Return error if group doesn't exist
  if (!groups[name]) {
    return callback(new Error(`Group not found: ${name}`));
  }

  // No-op if node is invalid
  if (!node || typeof node !== 'object') {
    return callback(null, groups[name]);
  }

  // Add node to the group using its SID as the key
  const sid = id.getSID(node);
  groups[name][sid] = node;

  return callback(null, groups[name]);
}

/**
 * @param {string} name
 * @param {string} nodeSID
 * @param {Callback} callback
 */
function rem(name, nodeSID, callback) {
  // Handle case where only callback is passed
  if (typeof name === 'function') {
    callback = name;
    return callback(new Error('Group name is required'));
  }

  // Handle case where nodeSID is the callback
  if (typeof nodeSID === 'function') {
    callback = nodeSID;
    return callback(new Error('Node SID is required'));
  }

  callback = callback || function () { };

  if (!name || typeof name !== 'string') {
    return callback(new Error('Group name is required'));
  }

  // Return error if group doesn't exist
  if (!groups[name]) {
    return callback(new Error(`Group not found: ${name}`));
  }

  // No-op if node doesn't exist in the group (just return current group)
  if (!nodeSID || typeof nodeSID !== 'string' || !groups[name][nodeSID]) {
    return callback(null, groups[name]);
  }

  // Remove node from the group
  delete groups[name][nodeSID];

  return callback(null, groups[name]);
}

module.exports = { get, put, del, add, rem };

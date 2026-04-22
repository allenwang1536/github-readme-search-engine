// @ts-check

// Native function/object mappings - maps native values to unique identifiers
const nativeToId = new Map();
const idToNative = new Map();

/**
 * Check if a value is native (function with [native code] or built-in object)
 * @param {any} val
 * @returns {boolean}
 */
function isNativeValue(val) {
  if (typeof val === 'function') {
    try {
      return val.toString().includes('[native code]');
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * Register a value in the native maps
 * @param {any} val
 * @param {string} id
 */
function registerNative(val, id) {
  if (!nativeToId.has(val)) {
    nativeToId.set(val, id);
    idToNative.set(id, val);
  }
}

/**
 * Recursively discover all functions from a root object
 * @param {any} root - The root object to traverse
 * @param {string} rootName - The name/path of the root object
 * @param {Set} visited - Set of already visited objects to handle cycles
 * @param {boolean} registerAll - Whether to register all functions (not just native)
 */
function discoverFunctions(root, rootName, visited, registerAll = false) {
  if (root === null || root === undefined) return;
  if (visited.has(root)) return;

  const type = typeof root;
  if (type !== 'object' && type !== 'function') return;

  visited.add(root);

  // If this is a function, register it
  if (type === 'function') {
    if (registerAll || isNativeValue(root)) {
      registerNative(root, rootName);
    }
  }

  // Traverse properties
  try {
    const keys = Object.getOwnPropertyNames(root);
    for (const key of keys) {
      // Skip certain properties that cause issues
      if (key === 'constructor' || key === 'prototype' || key === 'caller' ||
        key === 'callee' || key === 'arguments' || key === '__proto__') {
        continue;
      }

      try {
        const val = root[key];
        if (val === null || val === undefined) continue;
        if (visited.has(val)) continue;

        const valType = typeof val;
        if (valType === 'function' || valType === 'object') {
          const newPath = `${rootName}.${key}`;
          discoverFunctions(val, newPath, visited, registerAll);
        }
      } catch (e) {
        // Skip properties that throw on access
      }
    }
  } catch (e) {
    // Skip objects that don't allow property enumeration
  }
}

// Initialize the native maps by discovering from root objects
const visited = new Set();

// E4: Dynamically discover ALL builtin libraries using require('repl')._builtinLibs
// This ensures support for all native objects in the current version of Node.js
const builtinLibs = require('repl')._builtinLibs || [];

for (const libName of builtinLibs) {
  try {
    // Normalize module name for use as identifier (e.g., 'fs/promises' -> 'fs_promises')
    const normalizedName = libName.replace(/\//g, '_');
    const lib = require(libName);
    discoverFunctions(lib, normalizedName, visited, true);
  } catch (e) {
    // Skip modules that fail to load (some may require specific conditions)
  }
}

// Discover from global objects - important builtins accessible via global
const safeGlobals = ['console', 'process', 'Buffer', 'JSON', 'Math',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Error',
  'RegExp', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Proxy', 'Reflect', 'Symbol', 'BigInt', 'Intl', 'Atomics',
  'SharedArrayBuffer', 'ArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];

for (const name of safeGlobals) {
  if (global[name] !== undefined) {
    discoverFunctions(global[name], name, visited, true);
  }
}

/**
 * Check if a function is native (contains [native code]) or from a tracked module
 * @param {Function} fn
 * @returns {boolean}
 */
function isNativeFunction(fn) {
  // Check if it's in our map (includes fs, os, path, etc.)
  if (nativeToId.has(fn)) {
    return true;
  }
  // Also check if it has [native code]
  return isNativeValue(fn);
}

/**
 * Try to identify a native/module function by its characteristics
 * @param {Function} fn
 * @returns {string|null}
 */
function identifyNativeFunction(fn) {
  // Check our dynamically built map
  if (nativeToId.has(fn)) {
    return nativeToId.get(fn);
  }

  // For Jest compatibility: check if it matches known natives by reference
  // Jest may replace console methods, so we need to check the current environment
  const consoleLog = require('console').log;
  const consoleError = require('console').error;

  if (fn === consoleLog) {
    return 'console.log';
  }
  if (fn === consoleError) {
    return 'console.error';
  }

  return null;
}

/**
 * @param {any} object
 * @returns {string}
 */
function serialize(object) {
  const type = typeof object;

  // Handle null (typeof null === 'object', so check first)
  if (object === null) {
    return JSON.stringify({ type: 'null', value: '' });
  }

  // Handle undefined
  if (type === 'undefined') {
    return JSON.stringify({ type: 'undefined', value: '' });
  }

  // Handle number (including NaN, Infinity, -Infinity)
  if (type === 'number') {
    return JSON.stringify({ type: 'number', value: String(object) });
  }

  // Handle string
  if (type === 'string') {
    return JSON.stringify({ type: 'string', value: object });
  }

  // Handle boolean
  if (type === 'boolean') {
    return JSON.stringify({ type: 'boolean', value: String(object) });
  }

  // Handle function
  if (type === 'function') {
    return JSON.stringify({ type: 'function', value: object.toString() });
  }

  // Handle object types (Array, Date, Error, plain Object)
  if (type === 'object') {
    // Handle Array
    if (Array.isArray(object)) {
      const serializedValues = {};
      for (let i = 0; i < object.length; i++) {
        serializedValues[i] = JSON.parse(serialize(object[i]));
      }
      return JSON.stringify({ type: 'array', value: serializedValues });
    }

    // Handle Date
    if (object instanceof Date) {
      return JSON.stringify({ type: 'date', value: object.toISOString() });
    }

    // Handle Error
    if (object instanceof Error) {
      const errorObj = {
        name: JSON.parse(serialize(object.name)),
        message: JSON.parse(serialize(object.message)),
        cause: JSON.parse(serialize(object.cause)),
      };
      return JSON.stringify({
        type: 'error',
        value: { type: 'object', value: errorObj },
      });
    }

    // Handle plain Object
    const serializedObj = {};
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        serializedObj[key] = JSON.parse(serialize(object[key]));
      }
    }
    return JSON.stringify({ type: 'object', value: serializedObj });
  }

  // For now, throw an error for unsupported types
  throw new Error(`Unsupported type: ${type}`);
}


/**
 * @param {string} string
 * @returns {any}
 */
function deserialize(string) {
  if (typeof string !== 'string') {
    throw new Error(`Invalid argument type: ${typeof string}.`);
  }

  const parsed = JSON.parse(string);
  const { type, value } = parsed;

  // Handle null
  if (type === 'null') {
    return null;
  }

  // Handle undefined
  if (type === 'undefined') {
    return undefined;
  }

  // Handle number (including NaN, Infinity, -Infinity)
  if (type === 'number') {
    return Number(value);
  }

  // Handle string
  if (type === 'string') {
    return value;
  }

  // Handle boolean
  if (type === 'boolean') {
    return value === 'true';
  }

  // Handle function
  if (type === 'function') {
    // Use indirect eval to create the function in global scope
    return (0, eval)('(' + value + ')');
  }

  // Handle array
  if (type === 'array') {
    const result = [];
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        result[parseInt(key)] = deserialize(JSON.stringify(value[key]));
      }
    }
    return result;
  }

  // Handle date
  if (type === 'date') {
    return new Date(value);
  }

  // Handle error
  if (type === 'error') {
    const errorObj = deserialize(JSON.stringify(value));
    const error = new Error(errorObj.message);
    error.name = errorObj.name;
    if (errorObj.cause !== undefined) {
      error.cause = errorObj.cause;
    }
    return error;
  }

  // Handle object
  if (type === 'object') {
    const result = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        result[key] = deserialize(JSON.stringify(value[key]));
      }
    }
    return result;
  }

  // Unknown type
  throw new Error(`Unsupported type: ${type}`);
}

module.exports = {
  serialize,
  deserialize,
};

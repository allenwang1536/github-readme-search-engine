// @ts-check
/**
 * Shared factory for distributed mem and store services.
 * Both services are identical except for the local service name they delegate to.
 *
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").Node} Node
 *
 * @typedef {Object} StoreConfig
 * @property {string | null} key
 * @property {string} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 */

/**
 * @param {Config} config
 * @param {string} serviceName - 'mem' or 'store'
 */
function createService(config, serviceName) {
    const context = {
        gid: config.gid || 'all',
        hash: config.hash || globalThis.distribution.util.id.naiveHash,
        subset: config.subset,
        beaconStarted: false,
        previousGroup: null,
        snapshot: null,
    };

    /**
     * @param {SimpleConfig} configuration
     * @returns {{gid: string, key: string | null}}
     */
    function parseConfig(configuration) {
        if (configuration && typeof configuration === 'object') {
            return {
                gid: configuration.gid || context.gid,
                key: Object.prototype.hasOwnProperty.call(configuration, 'key') ? /** @type {string | null} */ (configuration.key) : null,
            };
        }
        return { gid: context.gid, key: /** @type {string | null} */ (configuration) };
    }

    /**
     * @param {Object.<string, Node>} group
     * @param {string} key
     */
    function pickNode(group, key) {
        const nodes = Object.values(group || {});
        if (nodes.length === 0) return null;

        const kid = globalThis.distribution.util.id.getID(key);
        const nids = nodes.map((node) => globalThis.distribution.util.id.getNID(node));
        const nid = context.hash(kid, nids);

        return nodes.find((node) => globalThis.distribution.util.id.getNID(node) === nid) || null;
    }

    /** @param {Object.<string, Node>} group */
    function groupSignature(group) {
        return Object.keys(group || {}).sort().join('|');
    }

    function ensureBeacon() {
        if (context.beaconStarted) return;
        context.beaconStarted = true;

        setImmediate(() => {
            const gossipService = globalThis.distribution[context.gid] &&
                globalThis.distribution[context.gid].gossip;
            if (!gossipService || typeof gossipService.at !== 'function') return;

            gossipService.at(500, () => {
                globalThis.distribution.local.groups.get(context.gid, (error, group) => {
                    if (error) return;

                    const sig = groupSignature(group);
                    if (context.snapshot === null) {
                        context.snapshot = sig;
                        context.previousGroup = { ...(group || {}) };
                        return;
                    }

                    if (sig !== context.snapshot) {
                        const oldGroup = context.previousGroup || {};
                        context.snapshot = sig;
                        context.previousGroup = { ...(group || {}) };
                        reconf(oldGroup, () => { });
                    }
                });
            }, () => { });
        });
    }

    /**
     * @param {SimpleConfig} configuration
     * @param {string} method
     * @param {Callback} callback
     */
    function sendKeyed(configuration, method, callback) {
        const cfg = parseConfig(configuration);

        globalThis.distribution.local.groups.get(cfg.gid, (groupErr, group) => {
            if (groupErr) return callback(groupErr);

            const node = pickNode(group, cfg.key);
            if (!node) return callback(new Error(`Group is empty: ${cfg.gid}`));

            const remote = { node, service: serviceName, method };
            return globalThis.distribution.local.comm.send(
                [{ gid: cfg.gid, key: cfg.key }], remote, callback,
            );
        });
    }

    /** @type {(configuration: SimpleConfig, callback: Callback) => void} */
    function get(configuration, callback) {
        ensureBeacon();
        const cfg = parseConfig(configuration);
        if (cfg.key !== null) return sendKeyed(cfg, 'get', callback);

        globalThis.distribution[context.gid].comm.send(
            [{ gid: cfg.gid, key: null }],
            { service: serviceName, method: 'get' },
            (errors, values) => {
                const merged = {};
                Object.values(values || {}).forEach((entry) => {
                    if (Array.isArray(entry)) {
                        entry.forEach((key) => { merged[key] = true; });
                    }
                });
                callback(errors || {}, Object.keys(merged));
            },
        );
    }

    /**
     * @param {any} state
     * @param {SimpleConfig} configuration
     * @param {Callback} callback
     */
    function put(state, configuration, callback) {
        ensureBeacon();
        const cfg = parseConfig(configuration);
        const key = cfg.key || globalThis.distribution.util.id.getID(state);

        globalThis.distribution.local.groups.get(cfg.gid, (groupErr, group) => {
            if (groupErr) return callback(groupErr);

            const node = pickNode(group, key);
            if (!node) return callback(new Error(`Group is empty: ${cfg.gid}`));

            const remote = { node, service: serviceName, method: 'put' };
            return globalThis.distribution.local.comm.send(
                [state, { gid: cfg.gid, key }], remote, (error) => callback(error, state),
            );
        });
    }

    /**
     * @param {any} state
     * @param {SimpleConfig} configuration
     * @param {Callback} callback
     */
    function append(state, configuration, callback) {
        ensureBeacon();
        const cfg = parseConfig(configuration);
        const key = cfg.key || globalThis.distribution.util.id.getID(state);

        globalThis.distribution.local.groups.get(cfg.gid, (groupErr, group) => {
            if (groupErr) return callback(groupErr);

            const node = pickNode(group, key);
            if (!node) return callback(new Error(`Group is empty: ${cfg.gid}`));

            const remote = { node, service: serviceName, method: 'append' };
            return globalThis.distribution.local.comm.send(
                [state, { gid: cfg.gid, key }], remote, callback,
            );
        });
    }

    /** @type {(configuration: SimpleConfig, callback: Callback) => void} */
    function del(configuration, callback) {
        ensureBeacon();
        return sendKeyed(configuration, 'del', callback);
    }

    /**
     * @param {Object.<string, Node>} configuration
     * @param {Callback} callback
     */
    function reconf(configuration, callback) {
        ensureBeacon();
        globalThis.distribution.local.groups.get(context.gid, (groupErr, currentGroup) => {
            if (groupErr) return callback(groupErr);

            const previousGroup = configuration || {};
            const oldEntries = Object.entries(previousGroup);
            if (oldEntries.length === 0) return callback(null, null);

            let pending = oldEntries.length;
            const allKeys = new Set();

            oldEntries.forEach(([, node]) => {
                globalThis.distribution.local.comm.send(
                    [{ gid: context.gid, key: null }],
                    { node, service: serviceName, method: 'get' },
                    (keysErr, keysOnNode) => {
                        if (!keysErr && Array.isArray(keysOnNode)) {
                            keysOnNode.forEach((key) => allKeys.add(key));
                        }
                        if (--pending === 0) relocate();
                    },
                );
            });

            function relocate() {
                const keyList = Array.from(allKeys);
                let left = keyList.length;
                if (left === 0) return callback(null, null);

                keyList.forEach((key) => {
                    const source = pickNode(previousGroup, key);
                    const destination = pickNode(currentGroup, key);

                    if (!source || !destination ||
                        globalThis.distribution.util.id.getNID(source) ===
                        globalThis.distribution.util.id.getNID(destination)) {
                        if (--left === 0) callback(null, null);
                        return;
                    }

                    globalThis.distribution.local.comm.send(
                        [{ gid: context.gid, key }],
                        { node: source, service: serviceName, method: 'get' },
                        (getErr, value) => {
                            if (getErr) {
                                if (--left === 0) callback(null, null);
                                return;
                            }

                            globalThis.distribution.local.comm.send(
                                [{ gid: context.gid, key }],
                                { node: source, service: serviceName, method: 'del' },
                                (delErr) => {
                                    if (delErr) {
                                        if (--left === 0) callback(null, null);
                                        return;
                                    }

                                    globalThis.distribution.local.comm.send(
                                        [value, { gid: context.gid, key }],
                                        { node: destination, service: serviceName, method: 'put' },
                                        () => {
                                            if (--left === 0) callback(null, null);
                                        },
                                    );
                                },
                            );
                        },
                    );
                });
            }
        });
    }

    return { get, put, append, del, reconf };
}

module.exports = createService;

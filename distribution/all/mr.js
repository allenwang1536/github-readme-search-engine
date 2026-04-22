// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../util/id.js").NID} NID
 */

/**
 * Map functions used for mapreduce
 * @callback Mapper
 * @param {string} key
 * @param {any} value
 * @returns {object[]}
 */

/**
 * Reduce functions used for mapreduce
 * @callback Reducer
 * @param {string} key
 * @param {any[]} value
 * @returns {object}
 */

/**
 * @typedef {Object} MRConfig
 * @property {Mapper} map
 * @property {Reducer} reduce
 * @property {string[]} keys
 *
 * @typedef {Object} Mr
 * @property {(configuration: MRConfig, callback: Callback) => void} exec
 */


/*
  Note: The only method explicitly exposed in the `mr` service is `exec`.
  Other methods, such as `map`, `shuffle`, and `reduce`, should be dynamically
  installed on the remote nodes and not necessarily exposed to the user.
*/

/**
 * @param {Config} config
 * @returns {Mr}
 */
function mr(config) {
  const context = {
    gid: config.gid || 'all',
  };

  /**
   * @param {MRConfig} configuration
   * @param {Callback} callback
   * @returns {void}
   */
  function exec(configuration, callback) {
    if (!configuration || typeof configuration.map !== 'function' ||
      typeof configuration.reduce !== 'function') {
      return callback(new Error('Invalid MR configuration: map/reduce required'));
    }

    const requestedKeys = Array.isArray(configuration.keys) ? configuration.keys : [];
    const mrID = globalThis.distribution.util.id.getID(`${configuration}${Date.now()}`);
    const mrServiceName = `mr-${mrID}`;
    // Separate service name for the coordinator's notify endpoint (local-only).
    const coordServiceName = `${mrServiceName}-coord`;
    const coordinatorNode = globalThis.distribution.node.config;

    // ── Scatter-Gather state ────────────────────────────────────────────────
    // Updated by scatterGather() before each phase; read by notify().
    let phaseRemaining = 0;
    let phaseErrors = {};
    let phaseValues = {};
    let phaseDone = null;

    // ── Coordinator service (self-registered locally) ───────────────────────
    // Each group node calls notify() once it finishes its current phase.
    // When all N nodes have checked in, the next phase is triggered.
    const coordinatorService = {
      notify: function (payload, cb) {
        const { sid, error, value } = payload;
        if (error) phaseErrors[sid] = error;
        else phaseValues[sid] = value;
        // Acknowledge the notify call immediately so the worker can return.
        cb(null, null);
        if (--phaseRemaining === 0 && phaseDone) {
          const done = phaseDone;
          phaseDone = null;
          done(
            Object.keys(phaseErrors).length > 0 ? phaseErrors : null,
            phaseValues,
          );
        }
      },
    };

    // ── Worker service (pushed to all group nodes) ──────────────────────────
    // Stores coordinator address so workers can call notify after each phase.
    const mrService = {
      mapper: configuration.map,
      reducer: configuration.reduce,
      requestedKeys,
      // Persisted in the remote routes registry so worker methods can
      // retrieve them after deserialization (closures don't survive the wire).
      _coordinatorNode: coordinatorNode,
      _coordServiceName: coordServiceName,

      map: function (mrGid, mrID, phaseKeys, callback) {
        if (typeof phaseKeys === 'function') {
          callback = phaseKeys;
          phaseKeys = null;
        }

        const mapGid = `${mrID}_map`;
        const storeService = globalThis.distribution.local.store;
        const svcName = `mr-${mrID}`;
        const mySID = globalThis.distribution.util.id.getSID(
          globalThis.distribution.node.config,
        );

        globalThis.distribution.local.routes.get(svcName, (e, svc) => {
          if (e || !svc) return callback(new Error('mr service not found'));
          const mapper = svc.mapper;
          const coordNode = svc._coordinatorNode;
          const coordSvcName = svc._coordServiceName;

          const notifyCoord = (value, cb) => {
            globalThis.distribution.local.comm.send(
              [{ sid: mySID, error: null, value }],
              { node: coordNode, service: coordSvcName, method: 'notify', gid: 'local' },
              cb,
            );
          };

          const keysToProcess =
            Array.isArray(phaseKeys) && phaseKeys.length > 0 ?
              phaseKeys : (Array.isArray(svc.requestedKeys) ? svc.requestedKeys : []);

          if (keysToProcess.length === 0) {
            return notifyCoord([], callback);
          }

          let pending = keysToProcess.length;
          const allMapped = [];

          keysToProcess.forEach((key) => {
            storeService.get({ gid: mrGid, key: key }, (e, value) => {
              if (e) {
                // Ignore missing remote keys; each node tries the full key list.
                if (--pending === 0) notifyCoord(allMapped, callback);
                return;
              }

              let mapped;
              try {
                mapped = mapper(key, value);
              } catch (err) {
                if (--pending === 0) notifyCoord(allMapped, callback);
                return;
              }

              // Normalize: mapper may return a single object or an array.
              if (mapped === null || mapped === undefined) mapped = [];
              if (!Array.isArray(mapped)) mapped = [mapped];

              if (mapped.length === 0) {
                if (--pending === 0) notifyCoord(allMapped, callback);
                return;
              }

              let storePending = mapped.length;
              mapped.forEach((obj) => {
                allMapped.push(obj);
                const entries = Object.entries(obj || {});
                if (entries.length === 0) {
                  if (--storePending === 0) {
                    if (--pending === 0) notifyCoord(allMapped, callback);
                  }
                  return;
                }

                let entryPending = entries.length;
                entries.forEach(([mKey, mValue]) => {
                  const uniqueKey = `${mKey}-${globalThis.distribution.util.id.getID(
                    Math.random().toString(),
                  )}`;
                  storeService.put(mValue, { gid: mapGid, key: uniqueKey }, () => {
                    if (--entryPending === 0) {
                      if (--storePending === 0) {
                        if (--pending === 0) notifyCoord(allMapped, callback);
                      }
                    }
                  });
                });
              });
            });
          });
        });
      },

      shuffle: function (gid, mrID, callback) {
        const mapGid = `${mrID}_map`;
        const shuffleGid = `${mrID}_reduce`;
        const storeService = globalThis.distribution.local.store;
        const svcName = `mr-${mrID}`;
        const mySID = globalThis.distribution.util.id.getSID(
          globalThis.distribution.node.config,
        );

        globalThis.distribution.local.routes.get(svcName, (e, svc) => {
          if (e || !svc) return callback(new Error('mr service not found'));
          const coordNode = svc._coordinatorNode;
          const coordSvcName = svc._coordServiceName;

          const notifyCoord = (error, value, cb) => {
            globalThis.distribution.local.comm.send(
              [{ sid: mySID, error, value }],
              { node: coordNode, service: coordSvcName, method: 'notify', gid: 'local' },
              cb,
            );
          };

          storeService.get({ gid: mapGid, key: null }, (e, keys) => {
            if (e || !keys || keys.length === 0) {
              return notifyCoord(null, [], callback);
            }

            globalThis.distribution.local.groups.get(gid, (groupErr, group) => {
              if (groupErr) {
                return notifyCoord(String(groupErr), [], callback);
              }

              const nodes = Object.values(group || {});
              if (nodes.length === 0) {
                return notifyCoord('Group is empty', [], callback);
              }

              let pending = keys.length;

              keys.forEach((storedKey) => {
                storeService.get({ gid: mapGid, key: storedKey }, (readErr, value) => {
                  if (readErr) {
                    if (--pending === 0) notifyCoord(null, [], callback);
                    return;
                  }

                  const lastDash = storedKey.lastIndexOf('-');
                  const logicalKey = lastDash >= 0 ?
                    storedKey.substring(0, lastDash) :
                    storedKey;

                  const kid = globalThis.distribution.util.id.getID(logicalKey);
                  const nids = nodes.map((n) => globalThis.distribution.util.id.getNID(n));
                  const nid = globalThis.distribution.util.id.naiveHash(kid, nids);
                  const targetNode = nodes.find(
                    (n) => globalThis.distribution.util.id.getNID(n) === nid,
                  ) || nodes[0];

                  const shuffleKey = `${logicalKey}-${globalThis.distribution.util.id.getID(
                    Math.random().toString(),
                  )}`;
                  const shuffleValue = { logicalKey, val: value };

                  globalThis.distribution.local.comm.send(
                    [shuffleValue, { gid: shuffleGid, key: shuffleKey }],
                    { node: targetNode, service: 'store', method: 'put', gid: 'local' },
                    () => {
                      storeService.del({ gid: mapGid, key: storedKey }, () => {
                        if (--pending === 0) notifyCoord(null, [], callback);
                      });
                    },
                  );
                });
              });
            });
          });
        });
      },

      reduce: function (gid, mrID, callback) {
        const shuffleGid = `${mrID}_reduce`;
        const storeService = globalThis.distribution.local.store;
        const svcName = `mr-${mrID}`;
        const mySID = globalThis.distribution.util.id.getSID(
          globalThis.distribution.node.config,
        );

        globalThis.distribution.local.routes.get(svcName, (e, svc) => {
          if (e || !svc) return callback(new Error('mr service not found'));
          const reducer = svc.reducer;
          const coordNode = svc._coordinatorNode;
          const coordSvcName = svc._coordServiceName;

          const notifyCoord = (error, value, cb) => {
            globalThis.distribution.local.comm.send(
              [{ sid: mySID, error, value }],
              { node: coordNode, service: coordSvcName, method: 'notify', gid: 'local' },
              cb,
            );
          };

          storeService.get({ gid: shuffleGid, key: null }, (e, entryKeys) => {
            if (e || !entryKeys || entryKeys.length === 0) {
              return notifyCoord(null, [], callback);
            }

            let pending = entryKeys.length;
            const grouped = {};

            entryKeys.forEach((entryKey) => {
              storeService.get({ gid: shuffleGid, key: entryKey }, (readErr, entry) => {
                if (!readErr && entry && entry.logicalKey !== undefined) {
                  if (!grouped[entry.logicalKey]) grouped[entry.logicalKey] = [];
                  grouped[entry.logicalKey].push(entry.val);
                }

                // Free shuffle storage as it is consumed.
                storeService.del({ gid: shuffleGid, key: entryKey }, () => {
                  if (--pending > 0) return;

                  const logicalKeys = Object.keys(grouped);
                  if (logicalKeys.length === 0) {
                    return notifyCoord(null, [], callback);
                  }

                  const results = [];
                  logicalKeys.forEach((logicalKey) => {
                    try {
                      const reduced = reducer(logicalKey, grouped[logicalKey]);
                      if (reduced !== null && reduced !== undefined) {
                        results.push(reduced);
                      }
                    } catch (err) {
                      // Continue reducing other keys even if one reducer call fails.
                    }
                  });

                  return notifyCoord(null, results, callback);
                });
              });
            });
          });
        });
      },
    };

    // ── scatterGather ───────────────────────────────────────────────────────
    // Arms the notify counter, fires a fire-and-forget message to every node
    // in the group, then waits for all N notify() calls before calling done.
    function scatterGather(method, args, done) {
      globalThis.distribution.local.groups.get(context.gid, (e, group) => {
        if (e) return done(e);
        const sids = Object.keys(group);
        if (sids.length === 0) return done(null, {});

        // Arm the counter BEFORE sending, so early notifies are counted correctly.
        phaseRemaining = sids.length;
        phaseErrors = {};
        phaseValues = {};
        phaseDone = done;

        // Fire-and-forget: nodes reply via coordinator.notify, not via this callback.
        globalThis.distribution[context.gid].comm.send(
          args,
          { service: mrServiceName, method },
          () => { },
        );
      });
    }

    function teardown(finalErr, finalValue) {
      // Best-effort cleanup of dynamic routes regardless of previous failures.
      globalThis.distribution[context.gid].comm.send(
        [mrServiceName],
        { service: 'routes', method: 'rem' },
        () => {
          globalThis.distribution.local.routes.rem(coordServiceName, () => {
            callback(finalErr, finalValue);
          });
        },
      );
    }

    // ── Orchestration ───────────────────────────────────────────────────────

    // Step 1: Self-register the coordinator service locally.
    globalThis.distribution.local.routes.put(coordinatorService, coordServiceName, () => {
      // Step 2: Push the worker service to all group nodes.
      globalThis.distribution[context.gid].comm.send(
        [mrService, mrServiceName],
        { service: 'routes', method: 'put' },
        (setupErrs) => {
          if (setupErrs && Object.keys(setupErrs).length > 0) {
            return teardown(setupErrs, null);
          }

          // Step 3: Map phase — scatter work, gather notify calls.
          scatterGather('map', [context.gid, mrID, requestedKeys], (mapErr, mapResults) => {
            if (mapErr) return teardown(mapErr, null);
            // Step 4: Shuffle phase on all nodes.
            scatterGather('shuffle', [context.gid, mrID], (shuffleErr) => {
              if (shuffleErr) return teardown(shuffleErr, null);

              // Step 5: Reduce phase on all nodes.
              scatterGather('reduce', [context.gid, mrID], (reduceErr, reduceResults) => {
                if (reduceErr) return teardown(reduceErr, null);

                // Step 6: Collect all reducer outputs on coordinator.
                const finalOutput = [];
                Object.values(reduceResults || {}).forEach((nodeResult) => {
                  if (Array.isArray(nodeResult)) {
                    nodeResult.forEach((result) => finalOutput.push(result));
                  }
                });

                return teardown(null, finalOutput);
              });
            });
          });
        },
      );
    });
  }

  return { exec };
}

module.exports = mr;

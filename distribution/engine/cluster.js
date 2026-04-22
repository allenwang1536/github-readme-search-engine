function registerGroup(gid, hashFn, nodes, callback) {
  const id = globalThis.distribution.util.id;
  const localSid = id.getSID(globalThis.distribution.node.config);
  const config = { gid: gid, hash: hashFn };

  globalThis.distribution.local.groups.put(config, nodes, (err) => {
    if (err) return callback(err);

    const remoteNodes = Object.values(nodes).filter(
      (n) => id.getSID(n) !== localSid,
    );
    let remaining = remoteNodes.length;
    if (remaining === 0) return callback(null);

    let firstError = null;
    remoteNodes.forEach((node) => {
      globalThis.distribution.local.comm.send(
        [config, nodes],
        { node: node, service: 'groups', method: 'put' },
        (e) => {
          if (e && !firstError) firstError = e;
          if (--remaining === 0) callback(firstError);
        },
      );
    });
  });
}

function setupCluster(remoteNodes, gid, hashFn, callback) {
  const id = globalThis.distribution.util.id;
  const coordNode = globalThis.distribution.node.config;

  const nodes = {};
  nodes[id.getSID(coordNode)] = coordNode;
  remoteNodes.forEach((n) => {
    nodes[id.getSID(n)] = n;
  });

  let spawnIdx = 0;
  function spawnNext() {
    if (spawnIdx >= remoteNodes.length) {
      registerGroup(gid, hashFn, nodes, (err) => {
        if (err) return callback(err);

        function cleanup(cb) {
          let rem = remoteNodes.length;
          if (rem === 0) {
            globalThis.distribution.node.server.close();
            return cb();
          }
          remoteNodes.forEach((node) => {
            globalThis.distribution.local.comm.send(
              [],
              { node: node, service: 'status', method: 'stop' },
              () => {
                if (--rem === 0) {
                  globalThis.distribution.node.server.close();
                  cb();
                }
              },
            );
          });
        }

        callback(null, { nodes: nodes, cleanup: cleanup });
      });
      return;
    }
    const node = remoteNodes[spawnIdx++];
    globalThis.distribution.local.status.spawn(node, () => spawnNext());
  }
  spawnNext();
}

module.exports = { registerGroup, setupCluster };

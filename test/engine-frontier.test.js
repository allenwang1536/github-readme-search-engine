const distribution = require('../distribution.js')({ ip: '127.0.0.1', port: 7100 });
const id = distribution.util.id;
const { createFrontier, STATUS } = require('../distribution/engine/frontier.js');
const { registerGroup } = require('../distribution/engine/cluster.js');

const localServer = null;
const n1 = { ip: '127.0.0.1', port: 7110 };
const n2 = { ip: '127.0.0.1', port: 7111 };
const n3 = { ip: '127.0.0.1', port: 7112 };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('FAIL:', msg);
  }
}

function cleanup(cb) {
  const nodes = [n1, n2, n3];
  let remaining = nodes.length;
  const tryStop = (node) => {
    distribution.local.comm.send([], { node, service: 'status', method: 'stop' }, () => {
      remaining--;
      if (remaining === 0) {
        distribution.node.server.close();
        cb();
      }
    });
  };
  nodes.forEach(tryStop);
}

distribution.node.start((server) => {
  const frontierGid = 'frontier-test';

  let spawned = 0;
  const spawnNode = (node, cb) => {
    distribution.local.status.spawn(node, (e, v) => {
      spawned++;
      cb();
    });
  };

  function afterSpawn() {
    const nodes = {};
    nodes[id.getSID(n1)] = n1;
    nodes[id.getSID(n2)] = n2;
    nodes[id.getSID(n3)] = n3;

    registerGroup(frontierGid, id.rendezvousHash, nodes, (err) => {
      if (err) {
        console.error('Failed to create group:', err);
        return cleanup(() => process.exit(1));
      }
      runTests();
    });
  }

  function runTests() {
    const frontier = createFrontier(frontierGid);

    console.log('--- Test: add single URL ---');
    frontier.add('https://stripe.com/blog/api-design', (err, result) => {
      assert(!err, 'add should not error');
      assert(result.added === true, 'first add should succeed');
      assert(result.url === 'https://stripe.com/blog/api-design', 'url returned');

      console.log('--- Test: duplicate detection ---');
      frontier.add('https://stripe.com/blog/api-design', (err2, result2) => {
        assert(!err2, 'dup add should not error');
        assert(result2.added === false, 'duplicate should be rejected');
        assert(result2.reason === 'duplicate', 'reason should be duplicate');

        console.log('--- Test: invalid URL ---');
        frontier.add('not a url', (err3, result3) => {
          assert(!err3, 'invalid url should not error');
          assert(result3.added === false, 'invalid should be rejected');
          assert(result3.reason === 'invalid-url', 'reason should be invalid-url');

          console.log('--- Test: add batch ---');
          const urls = [
            'https://engineering.fb.com/blog/ai',
            'https://netflixtechblog.com/blog/microservices',
            'https://uber.com/blog/maps',
            'https://stripe.com/blog/api-design', // duplicate
            'garbage url', // invalid
          ];
          frontier.addBatch(urls, (err4, batchResult) => {
            assert(!err4, 'addBatch should not error');
            assert(batchResult.added === 3, 'should add 3 new: got ' + batchResult.added);
            assert(batchResult.skipped === 2, 'should skip 2: got ' + batchResult.skipped);

            console.log('--- Test: claim ---');
            frontier.claim(2, (err5, claimed) => {
              assert(!err5, 'claim should not error');
              assert(claimed.length === 2, 'should claim 2: got ' + claimed.length);
              assert(typeof claimed[0] === 'string', 'claimed should be URL strings');

              frontier.get(claimed[0], (err6, entry) => {
                assert(!err6, 'get claimed entry should not error');
                assert(entry.status === STATUS.SEEN, 'claimed entry should be seen: ' + entry.status);

                console.log('--- Test: claim respects seen status ---');
                frontier.claim(10, (err7, claimed2) => {
                  assert(!err7, 'second claim should not error');
                  assert(claimed2.length === 2, 'should claim remaining 2: got ' + claimed2.length);

                  console.log('--- Test: markError ---');
                  frontier.markError(claimed[0], 'timeout', (err8, entry2) => {
                    assert(!err8, 'markError should not error');
                    assert(entry2.status === STATUS.ERROR, 'should be error status');
                    assert(entry2.error === 'timeout', 'should have reason');

                    console.log('--- Test: stats ---');
                    frontier.stats((err9, stats) => {
                      assert(!err9, 'stats should not error');
                      assert(stats.total === 4, 'total should be 4: got ' + stats.total);
                      assert(stats.seen >= 1, 'seen should be >= 1: got ' + stats.seen);
                      assert(stats.error >= 1, 'error should be >= 1: got ' + stats.error);
                      console.log('Stats:', JSON.stringify(stats));

                      console.log(`\n=== Frontier tests: ${passed}/${passed + failed} passed ===`);
                      cleanup(() => {
                        if (failed > 0) process.exit(1);
                        process.exit(0);
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  spawnNode(n1, () => {
    spawnNode(n2, () => {
      spawnNode(n3, afterSpawn);
    });
  });
});

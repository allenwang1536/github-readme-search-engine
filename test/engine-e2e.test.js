const http = require('http');
const distribution = require('../distribution.js')({ ip: '127.0.0.1', port: 7800 });
const id = distribution.util.id;
const { setupCluster, registerGroup } = require('../distribution/engine/cluster.js');
const { runIndexer } = require('../distribution/engine/indexer.js');
const { startFrontend } = require('../distribution/engine/frontend.js');

const n1 = { ip: '127.0.0.1', port: 7801 };

let passed = 0;
let failed = 0;
function assert(condition, msg) {
  if (condition) passed++;
  else { failed++; console.error('FAIL:', msg); }
}

const docs = {
  'https://blog.cloudflare.com/workers': {
    url: 'https://blog.cloudflare.com/workers',
    text: 'Cloudflare Workers lets you deploy serverless JavaScript functions at the edge. Workers run on every Cloudflare data center worldwide, providing ultra-low latency.',
    company: 'cloudflare',
    date: '2024-06-01',
  },
  'https://engineering.fb.com/ml': {
    url: 'https://engineering.fb.com/ml',
    text: 'Facebook uses machine learning for content recommendations and feed ranking. Our ML infrastructure processes billions of predictions daily.',
    company: 'facebook',
    date: '2024-03-15',
  },
  'https://netflixtechblog.com/microservices': {
    url: 'https://netflixtechblog.com/microservices',
    text: 'Netflix microservices architecture handles streaming for 200 million subscribers. Each microservice is independently deployable with its own database.',
    company: 'netflix',
    date: '2024-09-01',
  },
};

function httpGet(path, callback) {
  http.get('http://127.0.0.1:3456' + path, (res) => {
    let body = '';
    res.on('data', (c) => body += c);
    res.on('end', () => callback(null, res.statusCode, body));
  }).on('error', callback);
}

distribution.node.start(() => {
  setupCluster([n1], 'e2e-docs', id.rendezvousHash, (err, cluster) => {
    if (err) { console.error(err); process.exit(1); }

    registerGroup('e2e-index', id.rendezvousHash, cluster.nodes, (e2) => {
      if (e2) { console.error(e2); process.exit(1); }

      const urls = Object.keys(docs);
      let loaded = 0;
      urls.forEach((url) => {
        distribution['e2e-docs'].store.put(docs[url], url, () => {
          if (++loaded === urls.length) {
            runIndexer('e2e-docs', 'e2e-index', (ie, stats) => {
              console.log('Indexed:', JSON.stringify(stats));

              startFrontend({
                port: 3456,
                indexGid: 'e2e-index',
                docsGid: 'e2e-docs',
                totalDocs: urls.length,
              }, (fe, server) => {
                console.log('Frontend started on port 3456');
                runE2ETests(server, cluster.cleanup);
              });
            });
          }
        });
      });
    });
  });

  function runE2ETests(frontendServer, cleanup) {
    console.log('\n--- Test: GET / returns HTML ---');
    httpGet('/', (e1, status1, body1) => {
      assert(!e1, 'GET / should not error');
      assert(status1 === 200, 'GET / status should be 200, got ' + status1);
      assert(body1.includes('NodeSearch'), 'HTML should contain NodeSearch');
      assert(body1.includes('<form'), 'HTML should contain form');

      console.log('\n--- Test: GET /search?q=workers ---');
      httpGet('/search?q=workers', (e2, status2, body2) => {
        assert(!e2, 'search should not error');
        assert(status2 === 200, 'search status 200, got ' + status2);
        const data2 = JSON.parse(body2);
        console.log('  Results:', data2.results.length, 'elapsed:', data2.elapsed + 'ms');
        assert(data2.results.length >= 1, 'should have results for "workers"');
        const cf = data2.results.find((r) => r.company === 'cloudflare');
        assert(cf, 'cloudflare should appear for "workers"');
        if (cf) {
          assert(cf.score > 0, 'score should be positive');
          assert(cf.breakdown, 'breakdown should exist');
          console.log('  Cloudflare score:', cf.score, 'breakdown:', JSON.stringify(cf.breakdown));
        }

        console.log('\n--- Test: GET /search?q=microservices+streaming ---');
        httpGet('/search?q=microservices+streaming', (e3, status3, body3) => {
          assert(!e3, 'multi-term search should not error');
          const data3 = JSON.parse(body3);
          console.log('  Results:', data3.results.length, 'terms:', data3.terms);
          assert(data3.results.length >= 1, 'should have results');
          assert(data3.terms.length === 2, 'should have 2 query terms');

          console.log('\n--- Test: GET /search with empty query ---');
          httpGet('/search?q=', (e4, status4, body4) => {
            assert(status4 === 400, 'empty query should return 400, got ' + status4);

            console.log('\n--- Test: GET /status ---');
            httpGet('/status', (e5, status5, body5) => {
              assert(!e5, 'status should not error');
              assert(status5 === 200, 'status should return 200');
              const data5 = JSON.parse(body5);
              console.log('  Status:', JSON.stringify(data5));
              assert(data5.index, 'status should have index info');
              assert(data5.index.termCount > 0, 'should have terms indexed');
              assert(data5.docs, 'status should have docs info');
              assert(data5.docs.count === 3, 'should have 3 docs');

              console.log('\n--- Test: 404 for unknown route ---');
              httpGet('/unknown', (e6, status6) => {
                assert(status6 === 404, 'unknown route should be 404');

                console.log('\n=== E2E tests: ' + passed + '/' + (passed + failed) + ' passed ===');
                frontendServer.close(() => {
                  cleanup(() => process.exit(failed > 0 ? 1 : 0));
                });
              });
            });
          });
        });
      });
    });
  }
});

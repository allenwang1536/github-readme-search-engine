const distribution = require('../distribution.js')({ ip: '127.0.0.1', port: 7400 });
const id = distribution.util.id;
const { createFrontier } = require('../distribution/engine/frontier.js');
const { createCrawler } = require('../distribution/engine/crawler.js');
const { normalizeUrl } = require('../distribution/engine/policy.js');
const { setupCluster } = require('../distribution/engine/cluster.js');

const n1 = { ip: '127.0.0.1', port: 7401 };
const n2 = { ip: '127.0.0.1', port: 7402 };

let passed = 0;
let failed = 0;
function assert(condition, msg) {
  if (condition) passed++;
  else { failed++; console.error('FAIL:', msg); }
}

distribution.node.start(() => {
  setupCluster([n1, n2], 'crawl-frontier', id.rendezvousHash, (err, cluster1) => {
    if (err) {
      console.error('Frontier cluster setup failed:', err);
      process.exit(1);
    }
    const { registerGroup } = require('../distribution/engine/cluster.js');
    registerGroup('crawl-docs', id.rendezvousHash, cluster1.nodes, (err2) => {
      if (err2) {
        console.error('Docs group setup failed:', err2);
        process.exit(1);
      }
      runTest(cluster1.cleanup);
    });
  });

  function runTest(cleanup) {
    const frontier = createFrontier('crawl-frontier');
    const crawler = createCrawler(frontier, 'crawl-docs', { batchSize: 3 });

    const seedUrls = [
      'https://blog.cloudflare.com/',
      'https://engineering.fb.com/',
      'https://stripe.com/blog',
    ];

    console.log('[test] Adding seed URLs to frontier...');
    frontier.addBatch(seedUrls, (addErr, addResult) => {
      assert(!addErr, 'addBatch should not error');
      console.log(`[test] Added ${addResult.added} URLs`);

      console.log('[test] Running crawl batch (3 URLs)...');
      crawler.crawlBatch((crawlErr, crawlStats) => {
        assert(!crawlErr, 'crawlBatch should not error');
        console.log('[test] Crawl stats:', JSON.stringify(crawlStats));

        assert(crawlStats.crawled >= 1,
          'should crawl at least 1 page: got ' + crawlStats.crawled);

        console.log('[test] Checking stored documents...');
        distribution['crawl-docs'].store.get(null, (getErr, keys) => {
          console.log('[test] Doc keys in store:', keys ? keys.length : 0);

          if (keys && keys.length > 0) {
            const docKey = keys.find((k) => k.startsWith('http'));
            if (docKey) {
              distribution['crawl-docs'].store.get(docKey, (docErr, doc) => {
                if (!docErr && doc) {
                  console.log('[test] Sample doc:');
                  console.log('  URL:', doc.url || docKey);
                  console.log('  Title:', doc.title || '(none)');
                  console.log('  Company:', doc.company || '(none)');
                  console.log('  Text length:', (doc.text || '').length);
                  console.log('  Links:', (doc.links || []).length);
                  assert(doc.text && doc.text.length > 0, 'doc should have text');
                }
                finishTests(cleanup);
              });
            } else {
              finishTests(cleanup);
            }
          } else {
            finishTests(cleanup);
          }
        });
      });
    });
  }

  function finishTests(cleanup) {
    const frontier = createFrontier('crawl-frontier');
    frontier.stats((err, stats) => {
      console.log('[test] Frontier stats:', JSON.stringify(stats));
      assert(stats.seen >= 1, 'should have seen URLs: got ' + stats.seen);
      console.log(`\n=== Crawler integration: ${passed}/${passed + failed} passed ===`);
      cleanup(() => process.exit(failed > 0 ? 1 : 0));
    });
  }
});

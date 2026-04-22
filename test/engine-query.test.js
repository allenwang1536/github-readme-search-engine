const distribution = require('../distribution.js')({ ip: '127.0.0.1', port: 7600 });
const id = distribution.util.id;
const { setupCluster, registerGroup } = require('../distribution/engine/cluster.js');
const { runIndexer } = require('../distribution/engine/indexer.js');
const { search } = require('../distribution/engine/query.js');

const n1 = { ip: '127.0.0.1', port: 7601 };
const n2 = { ip: '127.0.0.1', port: 7602 };

let passed = 0;
let failed = 0;
function assert(condition, msg) {
  if (condition) passed++;
  else { failed++; console.error('FAIL:', msg); }
}

const docs = {
  'https://blog.cloudflare.com/http3': {
    url: 'https://blog.cloudflare.com/http3',
    text: 'HTTP/3 uses QUIC as its transport protocol. QUIC provides faster connection establishment and better performance than TCP. Cloudflare has been a leader in deploying QUIC across its global network.',
    company: 'cloudflare',
    date: '2024-06-15',
    links: [],
  },
  'https://engineering.fb.com/networking': {
    url: 'https://engineering.fb.com/networking',
    text: 'Facebook built a custom network protocol for its data centers. The protocol optimizes for low latency and high throughput across the global network infrastructure.',
    company: 'facebook',
    date: '2023-03-10',
    links: [],
  },
  'https://stripe.com/blog/api-design': {
    url: 'https://stripe.com/blog/api-design',
    text: 'Designing APIs at scale requires careful versioning and backward compatibility. Stripe uses protocol buffers internally while exposing a REST API to developers.',
    company: 'stripe',
    date: '2024-09-20',
    links: [],
  },
  'https://netflixtechblog.com/caching': {
    url: 'https://netflixtechblog.com/caching',
    text: 'Netflix caching infrastructure handles millions of requests per second. The caching layer sits between the API servers and the database, reducing latency significantly.',
    company: 'netflix',
    date: '2024-11-01',
    links: [],
  },
  'https://aws.amazon.com/blogs/database': {
    url: 'https://aws.amazon.com/blogs/database',
    text: 'Amazon DynamoDB provides single-digit millisecond latency at any scale. The database uses consistent hashing to distribute data across partitions for high availability and durability.',
    company: 'amazon',
    date: '2024-01-20',
    links: [],
  },
};

distribution.node.start(() => {
  setupCluster([n1, n2], 'q-docs', id.rendezvousHash, (err, cluster) => {
    if (err) { console.error(err); process.exit(1); }
    registerGroup('q-index', id.rendezvousHash, cluster.nodes, (e2) => {
      if (e2) { console.error(e2); process.exit(1); }
      loadAndIndex(cluster.cleanup);
    });
  });

  function loadAndIndex(cleanup) {
    const urls = Object.keys(docs);
    let loaded = 0;
    urls.forEach((url) => {
      distribution['q-docs'].store.put(docs[url], url, () => {
        if (++loaded === urls.length) {
          console.log('Loaded ' + loaded + ' docs, running indexer...');
          runIndexer('q-docs', 'q-index', (e, stats) => {
            console.log('Indexed:', JSON.stringify(stats));
            runQueryTests(cleanup);
          });
        }
      });
    });
  }

  function runQueryTests(cleanup) {
    console.log('\n--- Test: single-term query "protocol" ---');
    search('protocol', 'q-index', { totalDocs: 5 }, (e1, r1) => {
      assert(!e1, 'query should not error');
      console.log('Results:', r1.results.length, 'terms:', r1.terms);
      assert(r1.results.length >= 2, 'protocol should match >=2 docs');
      assert(r1.terms[0] === 'protocol', 'query term should be "protocol"');
      const fbIdx = r1.results.findIndex((r) => r.company === 'facebook');
      console.log('  Facebook rank:', fbIdx + 1, 'score:', r1.results[fbIdx] && r1.results[fbIdx].score);
      r1.results.forEach((r) => console.log('  ' + r.company + ' score=' + r.score));

      console.log('\n--- Test: multi-term query "network latency" ---');
      search('network latency', 'q-index', { totalDocs: 5 }, (e2, r2) => {
        assert(!e2, 'query should not error');
        console.log('Results:', r2.results.length, 'terms:', r2.terms);
        assert(r2.results.length >= 2, 'should match >=2 docs');
        assert(r2.terms.length === 2, 'should have 2 query terms');
        r2.results.forEach((r) => console.log('  ' + r.company + ' score=' + r.score +
          ' matched=' + r.matchedTerms.join(',')));

        console.log('\n--- Test: no results query ---');
        search('xyznonexistent', 'q-index', { totalDocs: 5 }, (e3, r3) => {
          assert(!e3, 'query should not error');
          assert(r3.results.length === 0, 'should have 0 results');

          console.log('\n--- Test: query with stopwords only ---');
          search('the and or', 'q-index', { totalDocs: 5 }, (e4, r4) => {
            assert(!e4, 'stopword-only query should not error');
            assert(r4.results.length === 0, 'stopwords-only should return 0 results');
            assert(r4.terms.length === 0, 'no query terms after filtering');

            console.log('\n--- Test: score breakdown present ---');
            search('caching database', 'q-index', { totalDocs: 5 }, (e5, r5) => {
              assert(!e5, 'query should not error');
              r5.results.forEach((r) => {
                assert(r.breakdown, r.url + ' should have score breakdown');
                assert(typeof r.breakdown.tfidf === 'number', 'tfidf should be number');
                assert(typeof r.breakdown.recency === 'number', 'recency should be number');
                console.log('  ' + r.company + ' score=' + r.score +
                  ' tfidf=' + r.breakdown.tfidf +
                  ' recency=' + r.breakdown.recency);
              });

              const netflix = r5.results.find((r) => r.company === 'netflix');
              const amazon = r5.results.find((r) => r.company === 'amazon');
              if (netflix && amazon) {
                assert(netflix.breakdown.recency >= amazon.breakdown.recency,
                  'newer netflix doc should have >= recency than amazon');
              }

              console.log('\n=== Query engine tests: ' + passed + '/' + (passed + failed) + ' passed ===');
              cleanup(() => process.exit(failed > 0 ? 1 : 0));
            });
          });
        });
      });
    });
  }
});

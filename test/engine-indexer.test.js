const distribution = require('../distribution.js')({ ip: '127.0.0.1', port: 7500 });
const id = distribution.util.id;
const { setupCluster, registerGroup } = require('../distribution/engine/cluster.js');
const { createMapFn, createReduceFn, runIndexer, lookupTerm, indexStats } = require('../distribution/engine/indexer.js');

const n1 = { ip: '127.0.0.1', port: 7501 };
const n2 = { ip: '127.0.0.1', port: 7502 };

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
    date: '2023-06-15',
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
    date: '2023-09-20',
    links: [],
  },
  'https://netflixtechblog.com/caching': {
    url: 'https://netflixtechblog.com/caching',
    text: 'Netflix caching infrastructure handles millions of requests per second. The caching layer sits between the API servers and the database, reducing latency significantly.',
    company: 'netflix',
    date: '2023-11-01',
    links: [],
  },
};

distribution.node.start(() => {
  setupCluster([n1, n2], 'idx-docs', id.rendezvousHash, (err, cluster) => {
    if (err) {
      console.error('Cluster setup failed:', err);
      process.exit(1);
    }

    registerGroup('idx-index', id.rendezvousHash, cluster.nodes, (err2) => {
      if (err2) {
        console.error('Index group setup failed:', err2);
        process.exit(1);
      }
      loadDocs(cluster.cleanup);
    });
  });

  function loadDocs(cleanup) {
    console.log('--- Loading documents ---');
    const urls = Object.keys(docs);
    let loaded = 0;

    urls.forEach((url) => {
      distribution['idx-docs'].store.put(docs[url], url, (e) => {
        if (e) console.error('Put error:', e);
        loaded++;
        if (loaded === urls.length) {
          console.log('Loaded ' + loaded + ' documents');
          runMR(cleanup);
        }
      });
    });
  }

  function runMR(cleanup) {
    console.log('\n--- Running indexer MapReduce ---');
    runIndexer('idx-docs', 'idx-index', (err, stats) => {
      assert(!err, 'runIndexer should not error: ' + err);
      console.log('Index stats:', JSON.stringify(stats));
      assert(stats.docs === 4, 'should index 4 docs, got ' + stats.docs);
      assert(stats.terms > 10, 'should have >10 terms, got ' + stats.terms);

      verifyIndex(cleanup);
    });
  }

  function verifyIndex(cleanup) {
    console.log('\n--- Verifying inverted index ---');

    indexStats('idx-index', (err, stats) => {
      console.log('Index term count:', stats.termCount);
      assert(stats.termCount > 10, 'should have >10 terms stored');

      lookupTerm('idx-index', 'protocol', (e1, postings1) => {
        console.log('\nTerm "protocol":');
        console.log('  Postings:', postings1.length);
        postings1.forEach((p) => console.log('    ' + p.company + ' tf=' + p.tf));
        assert(postings1.length >= 2, '"protocol" should have >=2 postings, got ' + postings1.length);

        lookupTerm('idx-index', 'network', (e2, postings2) => {
          console.log('\nTerm "network":');
          console.log('  Postings:', postings2.length);
          postings2.forEach((p) => console.log('    ' + p.company + ' tf=' + p.tf));
          assert(postings2.length >= 2, '"network" should have >=2 postings, got ' + postings2.length);

          lookupTerm('idx-index', 'cach', (e3, postings3) => {
            console.log('\nTerm "cach" (caching):');
            console.log('  Postings:', postings3.length);
            postings3.forEach((p) => console.log('    ' + p.company + ' tf=' + p.tf));
            assert(postings3.length >= 1, '"cach" should have >=1 postings');
            const netflixPost = postings3.find((p) => p.company === 'netflix');
            assert(netflixPost, 'netflix should have cach posting');
            if (netflixPost) {
              assert(netflixPost.tf >= 2, 'netflix cach tf should be >=2, got ' + netflixPost.tf);
            }

            lookupTerm('idx-index', 'xyznonexistent', (e4, postings4) => {
              console.log('\nTerm "xyznonexistent":');
              console.log('  Postings:', postings4.length);
              assert(postings4.length === 0, 'nonexistent term should have 0 postings');

              lookupTerm('idx-index', 'api', (e5, postings5) => {
                console.log('\nTerm "api":');
                postings5.forEach((p) => console.log('    url=' + p.url + ' company=' + p.company + ' date=' + p.date));
                const stripePost = postings5.find((p) => p.company === 'stripe');
                assert(stripePost, 'stripe should have api posting');
                if (stripePost) {
                  assert(stripePost.date === '2023-09-20', 'date should be preserved');
                  assert(stripePost.url === 'https://stripe.com/blog/api-design', 'url should be preserved');
                }

                console.log('\n=== Indexer tests: ' + passed + '/' + (passed + failed) + ' passed ===');
                cleanup(() => process.exit(failed > 0 ? 1 : 0));
              });
            });
          });
        });
      });
    });
  }
});

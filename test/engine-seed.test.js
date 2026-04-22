const {
  fetchEngineeringBlogs,
  fetchDevToArticles,
  fetchHackerNewsUrls,
  expandDomains,
  runSeed,
} = require('../distribution/engine/seed.js');
const { normalizeUrl } = require('../distribution/engine/policy.js');

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

console.log('--- expandDomains ---');

const expanded = expandDomains(['stripe.com', 'engineering.fb.com']);
assert(expanded.length > 0, 'should produce expanded URLs');
assert(expanded.includes('https://stripe.com/'), 'should include stripe root');
assert(expanded.includes('https://stripe.com/blog'), 'should include stripe /blog');
assert(expanded.includes('https://stripe.com/engineering'), 'should include stripe /engineering');
assert(expanded.includes('https://stripe.com/tech'), 'should include stripe /tech');
assert(expanded.includes('https://engineering.fb.com/'), 'should include fb root');

assert(expanded.length >= 20, 'should have >= 20 expanded URLs, got ' + expanded.length);
console.log(`expandDomains: ${expanded.length} URLs generated`);

console.log('--- Deduplication in expandDomains ---');
const dup = expandDomains(['example.com', 'example.com']);
const dupSet = new Set(dup);
assert(dup.length === dupSet.size, 'expandDomains should deduplicate');

console.log(`\nUnit tests: ${passed}/${passed + failed} passed`);

console.log('\n--- Live: fetchEngineeringBlogs ---');
let liveTestsRemaining = 3;

function finishLive() {
  if (--liveTestsRemaining === 0) {
    console.log(`\n=== Seed tests: ${passed}/${passed + failed} passed ===`);
    if (failed > 0) process.exit(1);

    console.log('\n--- Full runSeed (skipHN=true) ---');
    runSeed({ skipHN: true, expand: true }, (err, result) => {
      if (err) {
        console.error('runSeed error:', err);
        process.exit(1);
      }
      console.log('runSeed stats:', JSON.stringify(result.stats, null, 2));
      console.log(`Total unique URLs: ${result.urls.length}`);
      console.log(`Total domains: ${result.domains.length}`);
      console.log('Sample URLs:');
      for (let i = 0; i < Math.min(10, result.urls.length); i++) {
        console.log('  ', result.urls[i]);
      }
      process.exit(0);
    });
  }
}

fetchEngineeringBlogs((err, result) => {
  assert(!err, 'fetchEngineeringBlogs should not error: ' + (err && err.message));
  if (result) {
    assert(result.urls.length > 100, 'should have >100 blog URLs, got ' + result.urls.length);
    assert(result.domains.length > 50, 'should have >50 domains, got ' + result.domains.length);
    console.log(`  Found ${result.urls.length} URLs from ${result.domains.length} domains`);
    console.log('  Sample:', result.urls.slice(0, 5));
  }
  finishLive();
});

console.log('--- Live: fetchDevToArticles ---');
fetchDevToArticles((err, result) => {
  assert(!err, 'fetchDevToArticles should not error: ' + (err && err.message));
  if (result) {
    assert(result.urls.length > 10, 'should have >10 dev.to URLs, got ' + result.urls.length);
    console.log(`  Found ${result.urls.length} URLs from ${result.domains.length} domains`);
    console.log('  Sample:', result.urls.slice(0, 3));
  }
  finishLive();
});

console.log('--- Live: fetchHackerNewsUrls ---');
fetchHackerNewsUrls((err, result) => {
  assert(!err, 'fetchHackerNewsUrls should not error: ' + (err && err.message));
  if (result) {
    console.log(`  Found ${result.urls.length} URLs from ${result.domains.length} domains`);
    if (result.urls.length > 0) {
      console.log('  Sample:', result.urls.slice(0, 3));
    }
  }
  finishLive();
});

const {
  extractText, extractDate, extractTitle, extractLinks,
  parsePage, crawlOne, rateLimitWait,
} = require('../distribution/engine/crawler.js');
const { JSDOM } = require('jsdom');

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

const testHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Scaling Microservices at Stripe</title>
  <meta property="og:title" content="Scaling Microservices">
  <meta property="article:published_time" content="2024-03-15T10:00:00Z">
</head>
<body>
  <nav>Navigation links here</nav>
  <article>
    <time datetime="2024-03-15T10:00:00Z">March 15, 2024</time>
    <h1>Scaling Microservices at Stripe</h1>
    <p>At Stripe, we've been working on scaling our microservices architecture.
       Kubernetes and Docker containers help us deploy faster.</p>
    <p>Read more about <a href="/blog/infrastructure">our infrastructure</a>
       and <a href="https://engineering.fb.com/blog/scaling">Facebook's approach</a>.</p>
    <a href="mailto:team@stripe.com">Contact</a>
    <a href="javascript:void(0)">Click</a>
    <a href="#section2">Jump</a>
  </article>
  <footer>Footer content</footer>
  <script>var x = 1;</script>
  <style>.foo { color: red; }</style>
</body>
</html>`;

const dom = new JSDOM(testHtml);
const doc = dom.window.document;

console.log('--- extractText ---');
const text = extractText(testHtml);
assert(text.toLowerCase().includes('scaling microservices'), 'should contain title text');
assert(text.includes('Kubernetes'), 'should contain body text');
assert(text.includes('Docker'), 'should contain Docker');
assert(!text.includes('var x = 1'), 'should skip script content');
assert(!text.includes('color: red'), 'should skip style content');
console.log('  Text length:', text.length, 'chars');

console.log('--- extractTitle ---');
const title = extractTitle(doc);
assert(title === 'Scaling Microservices', 'should extract og:title: got "' + title + '"');

const dom2 = new JSDOM('<html><head><title>Fallback Title</title></head></html>');
const title2 = extractTitle(dom2.window.document);
assert(title2 === 'Fallback Title', 'should fallback to <title>');

console.log('--- extractDate ---');
const date = extractDate(doc);
assert(date !== null, 'should find a date');
assert(date.startsWith('2024-03-15'), 'should be 2024-03-15: got ' + date);

const dom3 = new JSDOM(
  '<html><head><meta property="article:published_time" content="2023-01-01T00:00:00Z"></head></html>',
);
const date3 = extractDate(dom3.window.document);
assert(date3 !== null && date3.startsWith('2023-01-01'), 'should extract from meta tag');

const dom4 = new JSDOM('<html><head></head></html>');
const date4 = extractDate(dom4.window.document);
assert(date4 === null, 'should return null when no date found');

console.log('--- extractLinks ---');
const links = extractLinks(doc, 'https://stripe.com/blog/scaling');
assert(links.length === 2, 'should find 2 valid links (skip mailto/javascript/#): got ' + links.length);
assert(links.some((l) => l.includes('stripe.com/blog/infrastructure')), 'should resolve relative link');
assert(links.some((l) => l.includes('engineering.fb.com')), 'should include absolute link');
assert(!links.some((l) => l.includes('mailto')), 'should skip mailto');
assert(!links.some((l) => l.includes('javascript')), 'should skip javascript');

console.log('--- parsePage ---');
const parsed = parsePage(testHtml, 'https://stripe.com/blog/scaling');
assert(parsed.url === 'https://stripe.com/blog/scaling', 'should have url');
assert(parsed.title === 'Scaling Microservices', 'should have title');
assert(parsed.text.length > 50, 'should have text');
assert(parsed.company === 'stripe', 'should extract company tag: got ' + parsed.company);
assert(parsed.date !== null, 'should have date');
assert(parsed.links.length === 2, 'should have 2 links');
assert(typeof parsed.crawledAt === 'string', 'should have crawledAt');

console.log('--- rateLimitWait ---');
const wait1 = rateLimitWait('https://example.com/page1', 1000);
assert(wait1 === 0, 'first request should have 0 wait');
const wait2 = rateLimitWait('https://example.com/page2', 1000);
assert(wait2 > 0, 'second request to same domain should wait: ' + wait2);
const wait3 = rateLimitWait('https://different.com/page1', 1000);
assert(wait3 === 0, 'different domain should have 0 wait');

console.log(`\n=== Crawler unit tests: ${passed}/${passed + failed} passed ===`);

console.log('\n--- Live: crawlOne ---');
crawlOne('https://blog.cloudflare.com/', (err, doc5) => {
  if (err) {
    console.log('  Live crawl skipped (network error):', err.message);
  } else {
    assert(doc5.url.includes('cloudflare.com'), 'should have correct url');
    assert(doc5.text.length > 100, 'should have text: ' + doc5.text.length + ' chars');
    assert(doc5.company === 'cloudflare', 'should have company: ' + doc5.company);
    assert(doc5.links.length > 5, 'should find links: ' + doc5.links.length);
    console.log('  Title:', doc5.title);
    console.log('  Text:', doc5.text.substring(0, 100) + '...');
    console.log('  Company:', doc5.company);
    console.log('  Date:', doc5.date);
    console.log('  Links found:', doc5.links.length);
  }
  console.log(`\n=== All crawler tests: ${passed}/${passed + failed} passed ===`);
  if (failed > 0) process.exit(1);
});

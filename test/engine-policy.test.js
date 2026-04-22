const { normalizeUrl, companyTag, hasAllowedPath, createPolicy } = require('../distribution/engine/policy.js');

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

console.log('--- normalizeUrl ---');

assert(normalizeUrl('https://blog.example.com/post/1') === 'https://blog.example.com/post/1', 'basic url');
assert(normalizeUrl('https://blog.example.com/post/1/') === 'https://blog.example.com/post/1', 'strip trailing slash');
assert(normalizeUrl('https://BLOG.EXAMPLE.COM/Post') === 'https://blog.example.com/Post', 'lowercase host');
assert(normalizeUrl('https://blog.example.com/post#section') === 'https://blog.example.com/post', 'strip fragment');
assert(normalizeUrl('https://blog.example.com:443/post') === 'https://blog.example.com/post', 'strip default port');
assert(normalizeUrl('http://blog.example.com:80/post') === 'http://blog.example.com/post', 'strip default port http');
assert(normalizeUrl('https://blog.example.com:8080/post') === 'https://blog.example.com:8080/post', 'keep non-default port');
assert(normalizeUrl('ftp://files.example.com/doc') === null, 'reject ftp');
assert(normalizeUrl('not a url') === null, 'reject garbage');
assert(normalizeUrl('') === null, 'reject empty');
assert(normalizeUrl('https://example.com') === 'https://example.com/', 'root without slash');
assert(normalizeUrl('https://example.com/') === 'https://example.com/', 'root with slash');

const qUrl = normalizeUrl('https://example.com/search?b=2&a=1');
assert(qUrl === 'https://example.com/search?a=1&b=2', 'sort query params: ' + qUrl);

console.log(`normalizeUrl: ${passed} passed`);

console.log('--- companyTag ---');
const prevPassed = passed;

assert(companyTag('https://engineering.fb.com/blog/post') === 'fb', 'fb from engineering subdomain');
assert(companyTag('https://blog.google.com/post') === 'google', 'google');
assert(companyTag('https://www.uber.com/blog/post') === 'uber', 'uber strips www');
assert(companyTag('https://netflixtechblog.com/post') === 'netflixtechblog', 'netflix tech blog');
assert(companyTag('https://stripe.com/blog/post') === 'stripe', 'stripe');

console.log(`companyTag: ${passed - prevPassed} passed`);

console.log('--- hasAllowedPath ---');
const prevPassed2 = passed;

assert(hasAllowedPath('https://example.com/') === true, 'root allowed');
assert(hasAllowedPath('https://example.com/blog/post') === true, '/blog allowed');
assert(hasAllowedPath('https://example.com/engineering/team') === true, '/engineering allowed');
assert(hasAllowedPath('https://example.com/developers/docs') === true, '/developers allowed');
assert(hasAllowedPath('https://example.com/posts/123') === true, '/posts allowed');
assert(hasAllowedPath('https://example.com/articles/abc') === true, '/articles allowed');
assert(hasAllowedPath('https://example.com/insights/report') === true, '/insights allowed');
assert(hasAllowedPath('https://example.com/news/latest') === true, '/news allowed');
assert(hasAllowedPath('https://example.com/releases/v2') === true, '/releases allowed');
assert(hasAllowedPath('https://example.com/changelog/2024') === true, '/changelog allowed');
assert(hasAllowedPath('https://example.com/techblog/entry') === true, '/techblog allowed');
assert(hasAllowedPath('https://example.com/tech/stack') === true, '/tech allowed');
assert(hasAllowedPath('https://example.com/careers/apply') === false, '/careers rejected');
assert(hasAllowedPath('https://example.com/about') === false, '/about rejected');
assert(hasAllowedPath('https://example.com/login') === false, '/login rejected');

console.log(`hasAllowedPath: ${passed - prevPassed2} passed`);

console.log('--- createPolicy ---');
const prevPassed3 = passed;

const policy = createPolicy(['example.com', 'blog.stripe.com', 'engineering.fb.com']);

assert(policy.isAllowed('https://example.com/blog/post') === true, 'allowed domain + path');
assert(policy.isAllowed('https://example.com/careers') === false, 'allowed domain + bad path');
assert(policy.isAllowed('https://evil.com/blog/post') === false, 'disallowed domain');
assert(policy.isAllowed('https://blog.stripe.com/posts/123') === true, 'subdomain match');
assert(policy.isAllowed('https://engineering.fb.com/blog/ai') === true, 'fb eng blog');
assert(policy.isAllowed('https://example.com/') === true, 'root always allowed');

assert(policy.isDomainAllowed('https://www.example.com/blog') === true, 'www.example.com matches example.com');
assert(policy.isDomainAllowed('https://blog.example.com/blog') === true, 'blog.example.com matches example.com');
assert(policy.isDomainAllowed('https://notexample.com/blog') === false, 'notexample.com does not match');

console.log(`createPolicy: ${passed - prevPassed3} passed`);

console.log(`\n=== Policy tests: ${passed}/${passed + failed} passed ===`);
if (failed > 0) process.exit(1);

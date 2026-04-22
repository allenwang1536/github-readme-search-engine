const http = require('http');
const https = require('https');
const { URL } = require('url');
const { JSDOM } = require('jsdom');
const { convert } = require('html-to-text');
const { normalizeUrl } = require('./policy.js');
const { isAllowedUrl } = require('./githubCrawlPolicy.js');

function fetchPage(url, callback, maxRedirects) {
  maxRedirects = maxRedirects === undefined ? 5 : maxRedirects;
  if (maxRedirects < 0) return callback(new Error('Too many redirects'));

  const mod = url.startsWith('https') ? https : http;
  const req = mod.get(url, {
    headers: {
      'User-Agent': 'NodeSearch/1.0 (educational crawler; Brown CS1380)',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      const next = new URL(res.headers.location, url).href;
      res.resume();
      return fetchPage(next, callback, maxRedirects - 1);
    }
    if (res.statusCode !== 200) {
      res.resume();
      return callback(new Error('HTTP ' + res.statusCode));
    }
    const ct = (res.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('xhtml')) {
      res.resume();
      return callback(new Error('Not HTML: ' + ct));
    }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        callback(new Error('Response too large'));
      }
    });
    res.on('end', () => callback(null, { html: body, finalUrl: url, statusCode: 200 }));
    res.on('error', callback);
  });
  req.on('error', callback);
  req.on('timeout', () => {
    req.destroy();
    callback(new Error('Request timed out'));
  });
}

function extractText(html, document) {
  try {
    const parts = [];

    const descEl = document.querySelector('.f4.my-3') ||
      document.querySelector('.Layout-sidebar p') ||
      document.querySelector('[data-testid="repo-description"] p') ||
      document.querySelector('p.f4') ||
      document.querySelector('#repo-content-pjax-container p');
    if (descEl) {
      const t = descEl.textContent.trim();
      if (t) parts.push(t);
    }

    if (parts.length === 0) {
      const metaDesc = document.querySelector('meta[property="og:description"]') ||
        document.querySelector('meta[name="description"]');
      if (metaDesc) {
        const content = (metaDesc.getAttribute('content') || '').trim();
        if (content) parts.push(content);
      }
    }

    const readmeEl = document.querySelector('#readme') ||
      document.querySelector('article.markdown-body') ||
      document.querySelector('.markdown-body');
    if (readmeEl) {
      parts.push(convert(readmeEl.innerHTML, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
        ],
      }).trim());
    }

    return parts.join('\n\n');
  } catch (_) {
    return '';
  }
}

function extractDate(document) {
  const timeEl = document.querySelector('time[datetime]');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime');
    if (dt && !isNaN(Date.parse(dt))) return new Date(dt).toISOString();
  }

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="date"]',
    'meta[name="publish-date"]',
    'meta[name="DC.date"]',
    'meta[property="article:modified_time"]',
  ];
  for (const sel of metaSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const content = el.getAttribute('content');
      if (content && !isNaN(Date.parse(content))) {
        return new Date(content).toISOString();
      }
    }
  }

  return null;
}

function extractTitle(document) {
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = ogTitle.getAttribute('content');
    if (content) return content.trim();
  }
  const titleEl = document.querySelector('title');
  if (titleEl) return titleEl.textContent.trim();
  return '';
}

function extractLinks(document, baseUrl) {
  const links = [];
  const seen = new Set();
  const anchors = document.querySelectorAll('a[href]');
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    if (/^(javascript|mailto|tel):/i.test(href)) continue;
    if (href.startsWith('#')) continue;
    try {
      const abs = new URL(href, baseUrl).href;
      const norm = normalizeUrl(abs);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        links.push(norm);
      }
    } catch (_) { /* invalid URL, skip */ }
  }
  return links;
}

function extractGithubMetadata(document, url) {
  const pathSegments = url.split('/');
  const repoOwner = pathSegments[3] || '';
  const repoName = pathSegments[4] || '';

  const descEl = document.querySelector('.f4.my-3') ||
    document.querySelector('.Layout-sidebar p') ||
    document.querySelector('[data-hovercard-type="repository"]');
  const description = descEl ? descEl.textContent.trim() : '';

  const langEl = document.querySelector('.d-inline span.color-fg-default');
  const language = langEl ? langEl.textContent.trim() : '';

  const topicEls = document.querySelectorAll('.topic-tag');
  const topics = [];
  for (const el of topicEls) {
    const t = el.textContent.trim();
    if (t) topics.push(t);
  }

  let stars = '';
  const starsEl = document.querySelector('#repo-stars-counter') ||
    document.querySelector('.social-count');
  if (starsEl) {
    stars = starsEl.textContent.trim();
  } else {
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      const content = ogDesc.getAttribute('content') || '';
      const starMatch = content.match(/([\d,]+)\s+star/i);
      if (starMatch) stars = starMatch[1];
    }
  }

  const relTimeEl = document.querySelector('relative-time');
  const lastCommitDate = relTimeEl ? (relTimeEl.getAttribute('datetime') || '') : '';

  const forkEl = document.querySelector('span.text-small');
  const isFork = forkEl ? /forked from/i.test(forkEl.textContent) : false;

  const archivedEl = document.querySelector('.archived-notice') ||
    document.querySelector('[data-view-component] .flash-warn');
  const isArchived = archivedEl ? /archived/i.test(archivedEl.textContent) : false;

  const readmeEl = document.querySelector('#readme');
  const readmeText = readmeEl ? readmeEl.textContent.trim() : '';
  const lowContent = readmeText.length < 50;

  return {
    repoOwner,
    repoName,
    description,
    language,
    topics,
    stars,
    lastCommitDate,
    isFork,
    isArchived,
    lowContent,
  };
}

function parsePage(html, url) {
  const virtualConsole = new (require('jsdom').VirtualConsole)();
  virtualConsole.on('error', () => { });
  const dom = new JSDOM(html, { virtualConsole });
  const document = dom.window.document;

  const metadata = extractGithubMetadata(document, url);

  return {
    url: url,
    html: html,
    text: extractText(html, document),
    links: extractLinks(document, url),
    metadata: metadata,
    fetchedAt: Date.now(),
  };
}

const domainTimestamps = {};

function rateLimitWait(url, minIntervalMs) {
  minIntervalMs = minIntervalMs || 1000;
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const now = Date.now();
    const last = domainTimestamps[domain] || 0;
    const elapsed = now - last;
    if (elapsed >= minIntervalMs) {
      domainTimestamps[domain] = now;
      return 0;
    }
    return minIntervalMs - elapsed;
  } catch (_) {
    return 0;
  }
}

function markDomainAccessed(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    domainTimestamps[domain] = Date.now();
  } catch (_) { }
}

function crawlOne(url, callback) {
  const wait = rateLimitWait(url);
  if (wait > 0) {
    return setTimeout(() => crawlOne(url, callback), wait);
  }
  markDomainAccessed(url);

  fetchPage(url, (err, result) => {
    if (err) return callback(err);
    try {
      const canonicalUrl = result.finalUrl || url;
      if (!isAllowedUrl(canonicalUrl)) {
        return callback(new Error('Redirected to disallowed URL: ' + canonicalUrl));
      }

      const doc = parsePage(result.html, canonicalUrl);
      callback(null, doc);
    } catch (parseErr) {
      callback(parseErr);
    }
  });
}

function createCrawler(frontier, docsGid, options) {
  const opts = Object.assign({ batchSize: 25, linkFilter: null }, options);

  function getDocStore() {
    return globalThis.distribution[docsGid].store;
  }

  function crawlBatch(callback) {
    const stats = { crawled: 0, errors: 0, linksFound: 0 };

    frontier.claim(opts.batchSize, (claimErr, urls) => {
      if (claimErr) return callback(claimErr);
      if (!urls || urls.length === 0) {
        return callback(null, stats);
      }

      let remaining = urls.length;

      function oneDone() {
        remaining--;
        if (remaining === 0) {
          callback(null, stats);
        }
      }

      for (const url of urls) {
        crawlOne(url, (err, doc) => {
          if (err) {
            stats.errors++;
            frontier.markError(url, err.message, () => oneDone());
            return;
          }

          stats.crawled++;

          getDocStore().put(doc, url, (putErr) => {
            if (putErr) {
              console.error('[crawler] Failed to store doc:', url, putErr.message);
            }

            const links = doc.links || [];
            if (links.length === 0) return oneDone();

            let linksRemaining = links.length;
            let linksAdded = 0;

            for (const link of links) {
              if (opts.linkFilter && !opts.linkFilter(link)) {
                linksRemaining--;
                if (linksRemaining === 0) {
                  stats.linksFound += linksAdded;
                  oneDone();
                }
                continue;
              }
              frontier.add(link, (addErr, result) => {
                if (!addErr && result && result.added) linksAdded++;
                linksRemaining--;
                if (linksRemaining === 0) {
                  stats.linksFound += linksAdded;
                  oneDone();
                }
              });
            }
          });
        });
      }
    });
  }

  function crawlRounds(rounds, callback) {
    const totals = { totalCrawled: 0, totalErrors: 0, totalLinks: 0, rounds: 0 };
    let round = 0;

    function nextRound() {
      if (round >= rounds) return callback(null, totals);

      round++;
      console.log(`[crawler] Starting round ${round}/${rounds}...`);

      crawlBatch((err, batchStats) => {
        if (err) {
          console.error(`[crawler] Round ${round} error:`, err.message);
        }
        if (batchStats) {
          totals.totalCrawled += batchStats.crawled;
          totals.totalErrors += batchStats.errors;
          totals.totalLinks += batchStats.linksFound;
          totals.rounds++;
          console.log(
            `[crawler] Round ${round}: ` +
            `${batchStats.crawled} crawled, ${batchStats.errors} errors, ` +
            `${batchStats.linksFound} new links`,
          );
        }
        setTimeout(nextRound, 100);
      });
    }

    nextRound();
  }

  function crawlLoop(loopOpts, callback) {
    if (typeof loopOpts === 'function') {
      callback = loopOpts;
      loopOpts = {};
    }
    const lo = Object.assign({ maxPages: Infinity, pauseMs: 500, onBatch: null }, loopOpts);
    const totals = { totalCrawled: 0, totalErrors: 0, totalLinks: 0, batches: 0 };

    function nextBatch() {
      if (totals.totalCrawled >= lo.maxPages) {
        return callback(null, totals);
      }

      crawlBatch((err, batchStats) => {
        if (err) {
          console.error('[crawler] Batch error:', err.message);
          return setTimeout(nextBatch, lo.pauseMs);
        }

        totals.batches++;
        if (batchStats) {
          totals.totalCrawled += batchStats.crawled;
          totals.totalErrors += batchStats.errors;
          totals.totalLinks += batchStats.linksFound;
        }

        if (lo.onBatch) lo.onBatch(batchStats, totals);

        if (!batchStats || (batchStats.crawled === 0 && batchStats.errors === 0)) {
          console.log('[crawler] No URLs available, stopping.');
          return callback(null, totals);
        }

        setTimeout(nextBatch, lo.pauseMs);
      });
    }

    nextBatch();
  }

  return {
    crawlBatch,
    crawlRounds,
    crawlLoop,
  };
}

module.exports = {
  fetchPage,
  extractText,
  extractDate,
  extractTitle,
  extractLinks,
  extractGithubMetadata,
  parsePage,
  crawlOne,
  createCrawler,
  rateLimitWait,
};

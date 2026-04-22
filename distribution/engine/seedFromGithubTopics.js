const http = require('http');
const https = require('https');
const { URL } = require('url');
const { normalizeUrl } = require('./policy.js');

function fetchUrl(url, callback, maxRedirects) {
    maxRedirects = maxRedirects === undefined ? 5 : maxRedirects;
    if (maxRedirects < 0) return callback(new Error('Too many redirects'));

    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
        headers: { 'User-Agent': 'NodeSearch/1.0 (educational crawler)' },
        timeout: 15000,
    }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = new URL(res.headers.location, url).href;
            res.resume();
            return fetchUrl(next, callback, maxRedirects - 1);
        }
        if (res.statusCode !== 200) {
            res.resume();
            return callback(new Error('HTTP ' + res.statusCode));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => callback(null, body));
        res.on('error', callback);
    });
    req.on('error', callback);
    req.on('timeout', () => {
        req.destroy();
        callback(new Error('Request timed out'));
    });
}

const TOPIC_SLUGS = [
    'javascript', 'python', 'typescript', 'rust', 'go',
    'java', 'cpp', 'distributed-systems', 'machine-learning', 'deep-learning',
    'database', 'web', 'api', 'cli', 'devops',
    'kubernetes', 'docker', 'react', 'nodejs', 'algorithms',
    'data-structures', 'operating-systems', 'networking', 'security', 'cryptography',
    'compiler', 'interpreter', 'game-engine', 'graphics', 'ios',
    'android', 'mobile', 'frontend', 'backend', 'microservices',
    'serverless', 'blockchain', 'open-source', 'framework', 'library',
    'testing', 'ci-cd', 'monitoring', 'search', 'nlp',
    'computer-vision', 'reinforcement-learning', 'data-science', 'visualization', 'embedded',
];

const TRENDING_LANGUAGES = [
    'javascript', 'python', 'typescript', 'java', 'go',
    'rust', 'c', 'cpp', 'csharp', 'ruby',
    'php', 'swift', 'kotlin', 'scala', 'shell',
    'lua', 'haskell', 'elixir', 'zig', 'dart',
];

function extractRepoLinks(html) {
    const repoPattern = /href="\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)"/g;
    const seen = new Set();
    const repos = [];
    let match;

    while ((match = repoPattern.exec(html)) !== null) {
        const path = match[1];
        const segments = path.split('/');
        if (segments.length !== 2) continue;
        const skipOwners = new Set([
            'topics', 'trending', 'explore', 'settings', 'login',
            'signup', 'marketplace', 'sponsors', 'apps', 'orgs',
            'notifications', 'pulls', 'issues', 'features', 'pricing',
            'security', 'enterprise', 'customer-stories', 'readme',
            'about', 'collections', 'events', 'team', 'contact',
        ]);
        if (skipOwners.has(segments[0].toLowerCase())) continue;
        if (!segments[0] || !segments[1]) continue;

        const fullUrl = 'https://github.com/' + path;
        if (!seen.has(fullUrl)) {
            seen.add(fullUrl);
            repos.push(fullUrl);
        }
    }

    return repos;
}

function fetchTopicPages(topicSlug, opts, callback) {
    if (typeof opts === 'function') {
        callback = opts;
        opts = {};
    }
    const maxPages = (opts && opts.maxPages) || 10;
    const delayMs = (opts && opts.delayMs) || 500;
    const allUrls = new Set();
    let page = 1;

    function fetchNext() {
        if (page > maxPages) {
            return callback(null, Array.from(allUrls));
        }

        const url = `https://github.com/topics/${topicSlug}?page=${page}`;
        fetchUrl(url, (err, html) => {
            if (err) {
            return callback(null, Array.from(allUrls));
            }

            const repos = extractRepoLinks(html);
            const prevSize = allUrls.size;
            for (const r of repos) allUrls.add(r);

            if (allUrls.size === prevSize) {
                return callback(null, Array.from(allUrls));
            }

            page++;
            setTimeout(fetchNext, delayMs);
        });
    }

    fetchNext();
}

function fetchTrendingPage(url, callback) {
    fetchUrl(url, (err, html) => {
        if (err) return callback(null, []);
        callback(null, extractRepoLinks(html));
    });
}

function seedFromGithubTopics(config, callback) {
    const frontier = config.frontier;
    const opts = config.options || {};
    const topics = opts.topics || TOPIC_SLUGS;
    const maxPagesPerTopic = opts.maxPagesPerTopic || 10;
    const delayMs = opts.delayMs || 500;
    const batchSize = opts.batchSize || 50;

    const allUrls = new Set();
    let topicIdx = 0;

    console.log(`[seed-github] Starting seed from ${topics.length} topics...`);

    function nextTopic() {
        if (topicIdx >= topics.length) {
            return fetchTrending();
        }

        const topic = topics[topicIdx++];
        console.log(`[seed-github] Fetching topic ${topicIdx}/${topics.length}: ${topic}`);

        fetchTopicPages(topic, { maxPages: maxPagesPerTopic, delayMs }, (err, urls) => {
            if (urls) {
                for (const u of urls) allUrls.add(u);
            }
            if (topicIdx % 10 === 0) {
                console.log(`[seed-github] Progress: ${topicIdx}/${topics.length} topics, ` +
                    `${allUrls.size} unique URLs so far`);
            }
            setTimeout(nextTopic, delayMs);
        });
    }

    function fetchTrending() {
        console.log('[seed-github] Fetching trending pages...');

        const trendingUrls = ['https://github.com/trending'];
        for (const lang of TRENDING_LANGUAGES) {
            trendingUrls.push(`https://github.com/trending/${lang}`);
        }

        let trendingIdx = 0;

        function nextTrending() {
            if (trendingIdx >= trendingUrls.length) {
                return writeToFrontier();
            }

            const url = trendingUrls[trendingIdx++];
            fetchTrendingPage(url, (err, urls) => {
                if (urls) {
                    for (const u of urls) allUrls.add(u);
                }
                setTimeout(nextTrending, delayMs);
            });
        }

        nextTrending();
    }

    function writeToFrontier() {
        const urls = Array.from(allUrls);
        console.log(`[seed-github] Total unique URLs discovered: ${urls.length}`);
        console.log(`[seed-github] Writing to frontier in batches of ${batchSize}...`);

        let offset = 0;
        let totalAdded = 0;
        let totalSkipped = 0;

        function writeBatch() {
            if (offset >= urls.length) {
                console.log('[seed-github] ========== Seed Summary ==========');
                console.log(`[seed-github] Total discovered: ${urls.length}`);
                console.log(`[seed-github] Already seen (skipped): ${totalSkipped}`);
                console.log(`[seed-github] Newly added to frontier: ${totalAdded}`);
                console.log('[seed-github] ================================');

                return callback(null, {
                    discovered: urls.length,
                    skipped: totalSkipped,
                    added: totalAdded,
                });
            }

            const batch = urls.slice(offset, offset + batchSize);
            offset += batchSize;

            frontier.addBatch(batch, (batchErr, batchResult) => {
                if (batchErr) {
                    console.error('[seed-github] Batch error at offset', offset, batchErr);
                }
                if (batchResult) {
                    totalAdded += batchResult.added;
                    totalSkipped += batchResult.skipped;
                }
                if (offset % 500 === 0 || offset >= urls.length) {
                    console.log(
                        `[seed-github] Progress: ${offset}/${urls.length} ` +
                        `(${totalAdded} added, ${totalSkipped} skipped)`,
                    );
                }
                writeBatch();
            });
        }

        writeBatch();
    }

    nextTopic();
}

module.exports = {
    seedFromGithubTopics,
    fetchTopicPages,
    fetchTrendingPage,
    extractRepoLinks,
    fetchUrl,
    TOPIC_SLUGS,
    TRENDING_LANGUAGES,
};

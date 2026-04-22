const http = require('http');
const url = require('url');
const { search } = require('./query.js');
const { indexStats } = require('./indexer.js');

function startFrontend(options, callback) {
  const port = options.port || 3000;
  const indexGid = options.indexGid;
  const frontierGid = options.frontierGid;
  const docsGid = options.docsGid;
  const totalDocs = options.totalDocs || 1000;
  const pagerankGid = options.pagerankGid;

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (pathname === '/' && req.method === 'GET') {
      serveSearchPage(res);
    } else if (pathname === '/search' && req.method === 'GET') {
      handleSearch(parsed.query, res);
    } else if (pathname === '/status' && req.method === 'GET') {
      handleStatus(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  function handleSearch(query, res) {
    const q = query.q || '';
    if (!q.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Query parameter q is required' }));
    }

    search(q, indexGid, { topN: 20, totalDocs: totalDocs, pagerankGid: pagerankGid },
      (err, result) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Search failed: ' + err.message }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
  }

  function handleStatus(res) {
    const status = { timestamp: Date.now() };

    indexStats(indexGid, (err, idxStats) => {
      status.index = idxStats || { termCount: 0 };

      if (docsGid && globalThis.distribution[docsGid]) {
        globalThis.distribution[docsGid].store.get(null, (e, keys) => {
          status.docs = { count: (keys && keys.length) || 0 };

          if (frontierGid) {
            getFrontierStats(frontierGid, (fStats) => {
              status.frontier = fStats;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(status));
            });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      }
    });
  }

  function getFrontierStats(gid, callback) {
    globalThis.distribution[gid].store.get(null, (err, keys) => {
      if (err && Object.keys(err).length > 0) {
        return callback({ total: 0, unseen: 0, seen: 0, error: 0 });
      }
      if (!keys || keys.length === 0) {
        return callback({ total: 0, unseen: 0, seen: 0, error: 0 });
      }

      const counts = { total: keys.length, unseen: 0, seen: 0, error: 0 };
      let done = 0;

      for (const key of keys) {
        globalThis.distribution[gid].store.get(key, (e, entry) => {
          if (!e && entry && entry.status) {
            counts[entry.status] = (counts[entry.status] || 0) + 1;
          }
          if (++done === keys.length) callback(counts);
        });
      }
    });
  }

  function serveSearchPage(res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(SEARCH_HTML);
  }

  server.listen(port, () => {
    callback(null, server);
  });
}

const SEARCH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NodeSearch</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a; color: #e0e0e0; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center;
  }
  .header {
    padding: 60px 20px 30px; text-align: center; width: 100%;
    max-width: 800px;
  }
  .header h1 {
    font-size: 42px; font-weight: 700; color: #fff;
    letter-spacing: -1px; margin-bottom: 8px;
  }
  .header h1 span { color: #4f9cf7; }
  .header p { color: #888; font-size: 14px; }
  .search-box {
    width: 100%; max-width: 700px; padding: 0 20px;
    margin-bottom: 20px;
  }
  .search-form {
    display: flex; background: #1a1a1a; border: 1px solid #333;
    border-radius: 12px; overflow: hidden;
    transition: border-color 0.2s;
  }
  .search-form:focus-within { border-color: #4f9cf7; }
  .search-form input {
    flex: 1; padding: 16px 20px; background: transparent;
    border: none; color: #fff; font-size: 16px; outline: none;
  }
  .search-form input::placeholder { color: #666; }
  .search-form button {
    padding: 16px 24px; background: #4f9cf7; color: #fff;
    border: none; font-size: 16px; cursor: pointer; font-weight: 600;
    transition: background 0.2s;
  }
  .search-form button:hover { background: #3a8ae5; }
  .meta-bar {
    width: 100%; max-width: 700px; padding: 0 20px;
    display: flex; justify-content: space-between;
    color: #666; font-size: 13px; margin-bottom: 16px;
  }
  .results {
    width: 100%; max-width: 700px; padding: 0 20px 40px;
  }
  .result-card {
    background: #141414; border: 1px solid #222; border-radius: 10px;
    padding: 20px; margin-bottom: 12px;
    transition: border-color 0.2s;
  }
  .result-card:hover { border-color: #444; }
  .result-url {
    font-size: 13px; color: #4f9cf7; word-break: break-all;
    margin-bottom: 6px;
  }
  .result-url a { color: #4f9cf7; text-decoration: none; }
  .result-url a:hover { text-decoration: underline; }
  .result-meta {
    display: flex; gap: 12px; font-size: 12px; color: #888;
    margin-bottom: 8px; flex-wrap: wrap;
  }
  .result-meta .tag {
    background: #1e293b; color: #94a3b8; padding: 2px 8px;
    border-radius: 4px; font-size: 11px;
  }
  .score-bar {
    display: flex; gap: 8px; font-size: 11px; color: #666;
    margin-top: 8px;
  }
  .score-bar .score-item {
    background: #1a1a1a; padding: 3px 8px; border-radius: 4px;
  }
  .score-bar .score-total {
    color: #4f9cf7; font-weight: 600;
  }
  .status-panel {
    width: 100%; max-width: 700px; padding: 0 20px 20px;
  }
  .status-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
  }
  .status-card {
    background: #141414; border: 1px solid #222; border-radius: 8px;
    padding: 12px; text-align: center;
  }
  .status-card .label { font-size: 11px; color: #666; text-transform: uppercase; }
  .status-card .value { font-size: 22px; color: #fff; font-weight: 700; margin-top: 4px; }
  .empty-state {
    text-align: center; padding: 60px 20px; color: #666;
  }
  .empty-state p { margin-bottom: 8px; }
</style>
</head>
<body>
<div class="header">
  <h1>Node<span>Search</span></h1>
  <p>Distributed search engine for engineering blogs</p>
</div>

<div class="search-box">
  <form class="search-form" id="searchForm">
    <input type="text" id="queryInput" placeholder="Search engineering blogs..." autofocus>
    <button type="submit">Search</button>
  </form>
</div>

<div class="meta-bar" id="metaBar" style="display:none">
  <span id="resultCount"></span>
  <span id="queryTime"></span>
</div>

<div class="results" id="results">
  <div class="empty-state" id="emptyState">
    <p>Search across thousands of engineering blog posts</p>
    <p style="font-size:12px">Try: kubernetes, caching, api design, distributed systems</p>
  </div>
</div>

<div class="status-panel" id="statusPanel">
  <div class="status-grid" id="statusGrid"></div>
</div>

<script>
  var searchForm = document.getElementById('searchForm');
  var queryInput = document.getElementById('queryInput');
  var resultsDiv = document.getElementById('results');
  var metaBar = document.getElementById('metaBar');
  var resultCount = document.getElementById('resultCount');
  var queryTime = document.getElementById('queryTime');
  var emptyState = document.getElementById('emptyState');
  var statusGrid = document.getElementById('statusGrid');

  searchForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var q = queryInput.value.trim();
    if (!q) return;
    doSearch(q);
  });

  function doSearch(q) {
    resultsDiv.innerHTML = '<div class="empty-state"><p>Searching...</p></div>';
    metaBar.style.display = 'none';

    fetch('/search?q=' + encodeURIComponent(q))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          resultsDiv.innerHTML = '<div class="empty-state"><p>Error: ' + data.error + '</p></div>';
          return;
        }
        renderResults(data);
      })
      .catch(function(err) {
        resultsDiv.innerHTML = '<div class="empty-state"><p>Network error</p></div>';
      });
  }

  function renderResults(data) {
    metaBar.style.display = 'flex';
    resultCount.textContent = data.totalMatches + ' result' + (data.totalMatches !== 1 ? 's' : '') +
      ' for "' + data.query + '"';
    queryTime.textContent = data.elapsed + 'ms';

    if (!data.results || data.results.length === 0) {
      resultsDiv.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
      return;
    }

    var html = '';
    data.results.forEach(function(r, i) {
      html += '<div class="result-card">';
      html += '<div class="result-url"><a href="' + r.url + '" target="_blank">' + r.url + '</a></div>';
      html += '<div class="result-meta">';
      if (r.repoOwner) html += '<span class="tag">' + r.repoOwner + '</span>';
      if (r.lastCommitDate) html += '<span>' + r.lastCommitDate + '</span>';
      if (r.isFork) html += '<span class="tag">fork</span>';
      if (r.isArchived) html += '<span class="tag">archived</span>';
      html += '<span>Matched: ' + (r.matchedTerms || []).join(', ') + '</span>';
      html += '</div>';
      html += '<div class="score-bar">';
      html += '<span class="score-item score-total">Score: ' + r.score + '</span>';
      if (r.breakdown) {
        html += '<span class="score-item">TF-IDF: ' + r.breakdown.tfidf + '</span>';
        html += '<span class="score-item">PageRank: ' + r.breakdown.pagerank_global + '</span>';
        html += '<span class="score-item">Recency: ' + r.breakdown.recency + '</span>';
      }
      html += '</div>';
      html += '</div>';
    });
    resultsDiv.innerHTML = html;
  }

  function loadStatus() {
    fetch('/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var html = '';
        if (data.index) {
          html += '<div class="status-card"><div class="label">Index Terms</div>' +
            '<div class="value">' + (data.index.termCount || 0).toLocaleString() + '</div></div>';
        }
        if (data.docs) {
          html += '<div class="status-card"><div class="label">Documents</div>' +
            '<div class="value">' + (data.docs.count || 0).toLocaleString() + '</div></div>';
        }
        if (data.frontier) {
          html += '<div class="status-card"><div class="label">Frontier</div>' +
            '<div class="value">' + (data.frontier.total || 0).toLocaleString() + '</div></div>';
          html += '<div class="status-card"><div class="label">Crawled</div>' +
            '<div class="value">' + (data.frontier.seen || 0).toLocaleString() + '</div></div>';
        }
        statusGrid.innerHTML = html;
      })
      .catch(function() {});
  }
  loadStatus();
  setInterval(loadStatus, 10000);
</script>
</body>
</html>`;

module.exports = { startFrontend };

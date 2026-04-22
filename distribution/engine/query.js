const { processQuery } = require('./textproc.js');

function search(query, indexGid, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const startTime = Date.now();
  const topN = (options && options.topN) || 20;
  const totalDocs = (options && options.totalDocs) || 1000;
  const pagerankGid = options && options.pagerankGid;

  const queryTerms = processQuery(query);
  if (queryTerms.length === 0) {
    return callback(null, {
      results: [],
      query: query,
      terms: [],
      elapsed: Date.now() - startTime,
    });
  }

  let pending = queryTerms.length;
  const termPostings = {};
  const termDocCounts = {};

  queryTerms.forEach((term) => {
    globalThis.distribution[indexGid].store.get(term, (err, postings) => {
      if (err || !postings) {
        termPostings[term] = [];
        termDocCounts[term] = 0;
      } else {
        const list = Array.isArray(postings) ? postings : [postings];
        termPostings[term] = list;
        termDocCounts[term] = list.length;
      }

      if (--pending === 0) {
        aggregateAndRank(queryTerms, termPostings, termDocCounts,
          totalDocs, pagerankGid, topN, startTime, query, callback);
      }
    });
  });
}

function aggregateAndRank(queryTerms, termPostings, termDocCounts,
  totalDocs, pagerankGid, topN, startTime, query, callback) {
  const urlData = {};

  queryTerms.forEach((term) => {
    const postings = termPostings[term];
    const df = termDocCounts[term];
    const idf = Math.log((totalDocs + 1) / (df + 1));

    postings.forEach((posting) => {
      const url = posting.url;
      if (!urlData[url]) {
        urlData[url] = {
          url: url,
          repoOwner: posting.repoOwner || '',
          topics: posting.topics || [],
          isFork: posting.isFork || false,
          isArchived: posting.isArchived || false,
          lowContent: posting.lowContent || false,
          lastCommitDate: posting.lastCommitDate || '',
          tfidf: 0,
          matchedTerms: [],
          termDetails: {},
        };
      }
      const tf = posting.tf || 1;
      const tfidfScore = tf * idf;
      urlData[url].tfidf += tfidfScore;
      urlData[url].matchedTerms.push(term);
      urlData[url].termDetails[term] = { tf: tf, idf: idf, tfidf: tfidfScore };
    });
  });

  const urls = Object.keys(urlData);
  if (urls.length === 0) {
    return callback(null, {
      results: [],
      query: query,
      terms: queryTerms,
      elapsed: Date.now() - startTime,
    });
  }

  const now = Date.now();
  const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

  urls.forEach((url) => {
    const entry = urlData[url];
    if (entry.lastCommitDate) {
      const dateMs = new Date(entry.lastCommitDate).getTime();
      if (!isNaN(dateMs)) {
        const age = now - dateMs;
        entry.recency = Math.max(0, 1 - (age / (3 * ONE_YEAR)));
      } else {
        entry.recency = 0.3;
      }
    } else {
      entry.recency = 0.3;
    }
  });

  if (pagerankGid) {
    lookupPageRanks(pagerankGid, urls, (prScores) => {
      finishRanking(urlData, prScores, topN, startTime, query, queryTerms, callback);
    });
  } else {
    const prScores = {};
    urls.forEach((url) => {
      prScores[url] = { global: 0.5, repoOwner: 0.5 };
    });
    finishRanking(urlData, prScores, topN, startTime, query, queryTerms, callback);
  }
}

function lookupPageRanks(pagerankGid, urls, callback) {
  const scores = {};
  let pending = urls.length;

  if (pending === 0) return callback(scores);

  urls.forEach((url) => {
    globalThis.distribution[pagerankGid].store.get(url, (err, val) => {
      if (!err && val) {
        scores[url] = {
          global: val.global || 0.5,
          repoOwner: val.repoOwner || 0.5,
        };
      } else {
        scores[url] = { global: 0.5, repoOwner: 0.5 };
      }
      if (--pending === 0) callback(scores);
    });
  });
}

function finishRanking(urlData, prScores, topN, startTime, query, queryTerms, callback) {
  const W_TFIDF = 0.65;
  const W_PAGERANK_GLOBAL = 0.20;
  const W_PAGERANK_REPOOWNER = 0.10;
  const W_RECENCY = 0.05;

  const urls = Object.keys(urlData);
  let maxTfidf = 0;
  urls.forEach((url) => {
    if (urlData[url].tfidf > maxTfidf) maxTfidf = urlData[url].tfidf;
  });
  if (maxTfidf === 0) maxTfidf = 1;

  const results = urls.map((url) => {
    const entry = urlData[url];
    const pr = prScores[url] || { global: 0.5, repoOwner: 0.5 };

    let normTfidf = entry.tfidf / maxTfidf;

    if (entry.lowContent) normTfidf *= 0.5;
    if (entry.isFork) normTfidf *= 0.7;

    let recency = entry.recency;
    if (entry.isArchived) recency *= 0.8;

    const score =
      (W_TFIDF * normTfidf) +
      (W_PAGERANK_GLOBAL * pr.global) +
      (W_PAGERANK_REPOOWNER * pr.repoOwner) +
      (W_RECENCY * recency);

    return {
      url: entry.url,
      repoOwner: entry.repoOwner,
      topics: entry.topics,
      lastCommitDate: entry.lastCommitDate,
      isFork: entry.isFork,
      isArchived: entry.isArchived,
      lowContent: entry.lowContent,
      score: Math.round(score * 10000) / 10000,
      breakdown: {
        tfidf: Math.round(normTfidf * 10000) / 10000,
        pagerank_global: Math.round(pr.global * 10000) / 10000,
        pagerank_repoOwner: Math.round(pr.repoOwner * 10000) / 10000,
        recency: Math.round(recency * 10000) / 10000,
      },
      matchedTerms: entry.matchedTerms,
      termDetails: entry.termDetails,
    };
  });

  results.sort((a, b) => b.score - a.score);

  callback(null, {
    results: results.slice(0, topN),
    query: query,
    terms: queryTerms,
    totalMatches: results.length,
    elapsed: Date.now() - startTime,
  });
}

module.exports = { search };

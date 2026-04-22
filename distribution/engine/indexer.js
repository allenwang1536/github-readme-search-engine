const { STOPWORDS, porterStem } = require('./textproc.js');

function getStopwordsString() {
  return Array.from(STOPWORDS).join('|');
}

function createMapFn() {
  /* eslint-disable no-unused-vars */
  const _stopStr = getStopwordsString();
  const _step2 = JSON.stringify({
    'ational': 'ate', 'tional': 'tion', 'enci': 'ence', 'anci': 'ance',
    'izer': 'ize', 'bli': 'ble', 'alli': 'al', 'entli': 'ent',
    'eli': 'e', 'ousli': 'ous', 'ization': 'ize', 'ation': 'ate',
    'ator': 'ate', 'alism': 'al', 'iveness': 'ive', 'fulness': 'ful',
    'ousness': 'ous', 'aliti': 'al', 'iviti': 'ive', 'biliti': 'ble',
    'logi': 'log',
  });
  const _step3 = JSON.stringify({
    'icate': 'ic', 'ative': '', 'alize': 'al', 'iciti': 'ic',
    'ical': 'ic', 'ful': '', 'ness': '',
  });

  const mapFn = new Function('key', 'value', `
    var STOP = new Set(${JSON.stringify(_stopStr)}.split('|'));
    var step2list = ${_step2};
    var step3list = ${_step3};

    var c = '[^aeiou]', v = '[aeiou]';
    var C = c + '[^aeiou]*', V = v + '[aeiou]*';
    var mgr0 = new RegExp('^(' + C + ')?' + V + C);
    var meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$');
    var mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C);
    var s_v = new RegExp('^(' + C + ')?' + v);

    function stem(w) {
      if (w.length < 3) return w;
      var s, sx, re, re2, re3, re4, fp;
      var fc = w.charAt(0);
      if (fc === 'y') w = fc.toUpperCase() + w.substring(1);
      re = /^(.+?)(ss|i)es$/; re2 = /^(.+?)([^s])s$/;
      if (re.test(w)) w = w.replace(re, '$1$2');
      else if (re2.test(w)) w = w.replace(re2, '$1$2');
      re = /^(.+?)eed$/; re2 = /^(.+?)(ed|ing)$/;
      if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = w.replace(/.$/,''); }
      else if (re2.test(w)) { fp = re2.exec(w); s = fp[1];
        if (s_v.test(s)) { w = s;
          if (/(at|bl|iz)$/.test(w)) w += 'e';
          else if (new RegExp('([^aeiouylsz])\\\\1$').test(w)) w = w.replace(/.$/,'');
          else if (new RegExp('^' + C + v + '[^aeiouwxy]$').test(w)) w += 'e';
        }
      }
      re = /^(.+?)y$/;
      if (re.test(w)) { fp = re.exec(w); s = fp[1]; if (s_v.test(s)) w = s + 'i'; }
      re = new RegExp('^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$');
      if (re.test(w)) { fp = re.exec(w); s = fp[1]; sx = fp[2]; if (mgr0.test(s)) w = s + step2list[sx]; }
      re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
      if (re.test(w)) { fp = re.exec(w); s = fp[1]; sx = fp[2]; if (mgr0.test(s)) w = s + step3list[sx]; }
      re = new RegExp('^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$');
      re2 = /^(.+?)(s|t)(ion)$/;
      if (re.test(w)) { fp = re.exec(w); s = fp[1]; if (mgr1.test(s)) w = s; }
      else if (re2.test(w)) { fp = re2.exec(w); s = fp[1]+fp[2]; if (mgr1.test(s)) w = s; }
      re = /^(.+?)e$/;
      if (re.test(w)) { fp = re.exec(w); s = fp[1];
        if (mgr1.test(s) || (meq1.test(s) && !new RegExp('^'+C+v+'[^aeiouwxy]$').test(s))) w = s;
      }
      if (/ll$/.test(w) && mgr1.test(w)) w = w.replace(/.$/,'');
      if (fc === 'y') w = w.charAt(0).toLowerCase() + w.substring(1);
      return w;
    }

    var text = '';
    if (typeof value === 'string') text = value;
    else if (value && value.text) text = value.text;
    if (!text) return [];

    var tokens = text.toLowerCase().replace(/[^a-z]/g, ' ').split(/\\s+/)
      .filter(function(w) { return w.length > 1 && !STOP.has(w); })
      .map(stem)
      .filter(function(w) { return w.length > 0; });

    if (tokens.length === 0) return [];

    var tf = {};
    for (var i = 0; i < tokens.length; i++) {
      tf[tokens[i]] = (tf[tokens[i]] || 0) + 1;
    }

    var url = key;
    var meta = (value && value.metadata) || {};
    var repoOwner = meta.repoOwner || '';
    var topics = meta.topics || [];
    var isFork = meta.isFork || false;
    var isArchived = meta.isArchived || false;
    var lowContent = meta.lowContent || false;
    var lastCommitDate = meta.lastCommitDate || '';

    var results = [];
    var terms = Object.keys(tf);
    for (var j = 0; j < terms.length; j++) {
      var o = {};
      o[terms[j]] = {url: url, tf: tf[terms[j]], repoOwner: repoOwner, topics: topics, isFork: isFork, isArchived: isArchived, lowContent: lowContent, lastCommitDate: lastCommitDate};
      results.push(o);
    }
    return results;
  `);
  /* eslint-enable no-unused-vars */

  return mapFn;
}

function createReduceFn() {
  const reduceFn = function (key, values) {
    const out = {};
    out[key] = values;
    return out;
  };
  return reduceFn;
}

function runIndexer(docsGid, indexGid, callback) {
  const startTime = Date.now();

  globalThis.distribution[docsGid].store.get(null, (err, keys) => {
    if (err && Object.keys(err).length > 0) return callback(err);
    if (!keys || keys.length === 0) {
      return callback(null, { terms: 0, docs: 0, elapsed: 0 });
    }

    const docCount = keys.length;

    const mrConfig = {
      keys: keys,
      map: createMapFn(),
      reduce: createReduceFn(),
    };

    globalThis.distribution[docsGid].mr.exec(mrConfig, (mrErr, results) => {
      if (mrErr) return callback(mrErr);
      if (!results || results.length === 0) {
        return callback(null, { terms: 0, docs: docCount, elapsed: Date.now() - startTime });
      }

      let stored = 0;
      let idx = 0;

      function storeNext() {
        if (idx >= results.length) {
          return callback(null, {
            terms: stored,
            docs: docCount,
            elapsed: Date.now() - startTime,
          });
        }

        const result = results[idx++];
        const term = Object.keys(result)[0];
        const postings = result[term];

        globalThis.distribution[indexGid].store.put(postings, term, (e) => {
          if (!e) stored++;
          storeNext();
        });
      }

      const BATCH_SIZE = 50;
      let batchStart = 0;

      function storeBatch() {
        if (batchStart >= results.length) {
          return callback(null, {
            terms: stored,
            docs: docCount,
            elapsed: Date.now() - startTime,
          });
        }

        const batchEnd = Math.min(batchStart + BATCH_SIZE, results.length);
        let pending = batchEnd - batchStart;

        for (let i = batchStart; i < batchEnd; i++) {
          const result = results[i];
          const term = Object.keys(result)[0];
          const postings = result[term];

          globalThis.distribution[indexGid].store.put(postings, term, (e) => {
            if (!e) stored++;
            if (--pending === 0) {
              batchStart = batchEnd;
              storeBatch();
            }
          });
        }
      }

      storeBatch();
    });
  });
}

function lookupTerm(indexGid, term, callback) {
  globalThis.distribution[indexGid].store.get(term, (err, postings) => {
    if (err) return callback(null, []);
    callback(null, Array.isArray(postings) ? postings : [postings]);
  });
}

function indexStats(indexGid, callback) {
  globalThis.distribution[indexGid].store.get(null, (err, keys) => {
    if (err && Object.keys(err).length > 0) {
      return callback(null, { termCount: 0 });
    }
    callback(null, { termCount: keys ? keys.length : 0 });
  });
}

module.exports = { createMapFn, createReduceFn, runIndexer, lookupTerm, indexStats };

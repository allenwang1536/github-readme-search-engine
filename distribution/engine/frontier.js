const { normalizeUrl } = require('./policy.js');

const STATUS = {
  UNSEEN: 'unseen',
  SEEN: 'seen',
  ERROR: 'error',
  INVALID: 'invalid-url',
};

function createFrontier(frontierGid) {
  function getStore() {
    return globalThis.distribution[frontierGid].store;
  }

  function add(rawUrl, callback) {
    const url = normalizeUrl(rawUrl);
    if (!url) {
      return callback(null, { url: rawUrl, added: false, reason: 'invalid-url' });
    }

    getStore().get(url, (err, _existing) => {
      if (!err) {
        return callback(null, { url, added: false, reason: 'duplicate' });
      }
      const entry = {
        url: url,
        status: STATUS.UNSEEN,
        addedAt: Date.now(),
      };
      getStore().put(entry, url, (putErr) => {
        if (putErr) return callback(putErr);
        return callback(null, { url, added: true });
      });
    });
  }

  function addBatch(urls, callback) {
    let added = 0;
    let skipped = 0;
    let idx = 0;

    function next() {
      if (idx >= urls.length) {
        return callback(null, { added, skipped });
      }
      add(urls[idx++], (err, result) => {
        if (err) return callback(err);
        if (result.added) added++;
        else skipped++;
        next();
      });
    }
    next();
  }

  function claim(n, callback) {
    const SCAN_CONCURRENCY = 50;
    getStore().get(null, (err, keys) => {
      if (err && Object.keys(err).length > 0) return callback(err);
      if (!keys || keys.length === 0) return callback(null, []);

      const shuffled = keys.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
      }

      const claimed = [];
      let offset = 0;
      let done = false;

      function nextWave() {
        if (done || claimed.length >= n || offset >= shuffled.length) {
          done = true;
          return callback(null, claimed);
        }

        const wave = shuffled.slice(offset, offset + SCAN_CONCURRENCY);
        offset += wave.length;
        let waveRemaining = wave.length;

        function waveItemDone() {
          waveRemaining--;
          if (waveRemaining === 0) {
            if (claimed.length >= n || offset >= shuffled.length) {
              done = true;
              callback(null, claimed);
            } else {
              nextWave();
            }
          }
        }

        for (const key of wave) {
          if (claimed.length >= n) {
            waveItemDone();
            continue;
          }
          getStore().get(key, (getErr, entry) => {
            if (!getErr && entry && entry.status === STATUS.UNSEEN && claimed.length < n) {
              entry.status = STATUS.SEEN;
              entry.claimedAt = Date.now();
              getStore().put(entry, key, (putErr) => {
                if (!putErr) claimed.push(key);
                waveItemDone();
              });
            } else {
              waveItemDone();
            }
          });
        }
      }

      nextWave();
    });
  }

  function markError(url, reason, callback) {
    if (typeof reason === 'function') {
      callback = reason;
      reason = 'unknown';
    }
    getStore().get(url, (err, entry) => {
      if (err) {
        const newEntry = { url, status: STATUS.ERROR, error: reason, errorAt: Date.now() };
        return getStore().put(newEntry, url, callback);
      }
      entry.status = STATUS.ERROR;
      entry.error = reason;
      entry.errorAt = Date.now();
      getStore().put(entry, url, (putErr) => {
        if (putErr) return callback(putErr);
        return callback(null, entry);
      });
    });
  }

  function stats(callback) {
    getStore().get(null, (err, keys) => {
      if (err && Object.keys(err).length > 0) {
        return callback(null, { unseen: 0, seen: 0, error: 0, total: 0 });
      }
      if (!keys || keys.length === 0) {
        return callback(null, { unseen: 0, seen: 0, error: 0, total: 0 });
      }

      const counts = { unseen: 0, seen: 0, error: 0, 'invalid-url': 0, total: keys.length };
      let done = 0;

      for (const key of keys) {
        getStore().get(key, (getErr, entry) => {
          if (!getErr && entry && entry.status) {
            counts[entry.status] = (counts[entry.status] || 0) + 1;
          }
          done++;
          if (done === keys.length) {
            return callback(null, counts);
          }
        });
      }
    });
  }

  function get(url, callback) {
    getStore().get(url, callback);
  }

  return {
    add,
    addBatch,
    claim,
    markError,
    stats,
    get,
    STATUS,
  };
}

module.exports = { createFrontier, STATUS };

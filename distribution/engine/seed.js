const { seedFromGithubTopics, fetchUrl } = require('./seedFromGithubTopics.js');
const { normalizeUrl } = require('./policy.js');

function runSeed(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  callback(null, {
    urls: [],
    domains: ['github.com'],
    stats: { source: 'github-topics' },
  });
}

function seedFrontier(frontier, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  console.log('[seed] Starting GitHub repository seed phase...');

  seedFromGithubTopics({
    frontier: frontier,
    options: {
      maxPagesPerTopic: (options && options.maxPagesPerTopic) || 10,
      topics: options && options.topics,
      batchSize: (options && options.batchSize) || 50,
    },
  }, (err, result) => {
    if (err) return callback(err);

    frontier.stats((statsErr, fStats) => {
      const frontierSize = (fStats && fStats.total) || (result ? result.added : 0);
      console.log(`[seed] Final frontier size: ${frontierSize} URLs`);
      callback(null, {
        added: result ? result.added : 0,
        skipped: result ? result.skipped : 0,
        discovered: result ? result.discovered : 0,
        frontierSize: frontierSize,
      });
    });
  });
}

module.exports = {
  runSeed,
  seedFrontier,
  fetchUrl,
  normalizeUrl,
};

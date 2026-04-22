#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
process.chdir(path.resolve(__dirname, '../..'));

function freePort(port) {
  try {
    const pids = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    if (pids) {
      pids.split('\n').filter(Boolean).forEach((pid) => {
        try { process.kill(Number(pid), 'SIGKILL'); } catch (_) { }
      });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      console.log(`[coord] Freed port ${port} (killed PID(s): ${pids.replace(/\n/g, ', ')})`);
    }
  } catch (_) { }
}

const yargs = require('yargs/yargs');
const args = yargs(process.argv.slice(2))
  .option('cluster', { type: 'string', demandOption: true, describe: 'Path to nodes.json' })
  .option('skip-seed', { type: 'boolean', default: false })
  .option('skip-crawl', { type: 'boolean', default: false })
  .option('skip-index', { type: 'boolean', default: false })
  .option('crawl-rounds', { type: 'number' })
  .option('frontend-port', { type: 'number' })
  .option('reset', { type: 'boolean', default: false, describe: 'Clear all stored data (frontier, docs, index) before starting' })
  .help()
  .parse();

const configPath = path.resolve(args.cluster);
if (!fs.existsSync(configPath)) {
  console.error('[coord] Config file not found:', configPath);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const coordCfg = config.coordinator;
const workerCfgs = config.workers || [];
const groupNames = config.groups || {};
const crawlCfg = config.crawl || {};

const frontierGid = groupNames.frontier || 'ns-frontier';
const docsGid = groupNames.docs || 'ns-docs';
const indexGid = groupNames.index || 'ns-index';
const crawlRounds = args['crawl-rounds'] || crawlCfg.rounds || 50;
const crawlBatchSize = crawlCfg.batchSize || 25;
const crawlDelay = crawlCfg.delayBetweenRounds || 2000;
const frontendPort = args['frontend-port'] || coordCfg.frontendPort || 3000;

freePort(coordCfg.port);
if (frontendPort !== coordCfg.port) freePort(frontendPort);

const distribution = require('../../distribution.js')({
  ip: '0.0.0.0',
  port: coordCfg.port,
});
const id = distribution.util.id;
const { registerGroup } = require('./cluster.js');
const { createFrontier } = require('./frontier.js');
const { seedFrontier } = require('./seed.js');
const { createCrawler } = require('./crawler.js');
const { runIndexer } = require('./indexer.js');
const { startFrontend } = require('./frontend.js');
const { isAllowedUrl } = require('./githubCrawlPolicy.js');

function log(msg) {
  console.log('[coord] ' + msg);
}

distribution.node.start((err) => {
  if (err) {
    console.error('[coord] Failed to start:', err.message);
    process.exit(1);
  }
  distribution.node.config.ip = coordCfg.ip;
  log('Coordinator running on ' + coordCfg.ip + ':' + coordCfg.port);
  log('Checking ' + workerCfgs.length + ' worker(s)...');
  pingWorkers(workerCfgs, (aliveWorkers) => {
    if (aliveWorkers.length === 0) {
      log('ERROR: No workers reachable. Start workers first.');
      process.exit(1);
    }
    log(aliveWorkers.length + '/' + workerCfgs.length + ' workers alive');
    setupGroups(aliveWorkers);
  });
});

function pingWorkers(workers, callback) {
  const alive = [];
  let pending = workers.length;
  const handled = new Set();

  if (pending === 0) return callback(alive);

  workers.forEach((worker, idx) => {
    const timeout = setTimeout(() => {
      if (handled.has(idx)) return;
      handled.add(idx);
      log('  ✗ ' + worker.ip + ':' + worker.port + ' — timeout');
      if (--pending === 0) callback(alive);
    }, 5000);

    distribution.local.comm.send(
      ['nid'],
      { node: worker, service: 'status', method: 'get' },
      (err, nid) => {
        clearTimeout(timeout);
        if (handled.has(idx)) return;
        handled.add(idx);
        if (err) {
          log('  ✗ ' + worker.ip + ':' + worker.port + ' — ' + err.message);
        } else {
          log('  ✓ ' + worker.ip + ':' + worker.port + ' (' + nid + ')');
          alive.push(worker);
        }
        if (--pending === 0) callback(alive);
      },
    );
  });
}

function setupGroups(workers) {
  log('Registering distributed groups...');

  const allNodes = {};
  workers.forEach((w) => {
    allNodes[id.getSID(w)] = w;
  });

  const totalNodes = Object.keys(allNodes).length;
  log('Cluster size: ' + totalNodes + ' nodes');

  registerGroup(frontierGid, id.rendezvousHash, allNodes, (e1) => {
    if (e1) { log('ERROR registering frontier: ' + e1); process.exit(1); }
    log('  ✓ ' + frontierGid);

    registerGroup(docsGid, id.rendezvousHash, allNodes, (e2) => {
      if (e2) { log('ERROR registering docs: ' + e2); process.exit(1); }
      log('  ✓ ' + docsGid);

      registerGroup(indexGid, id.rendezvousHash, allNodes, (e3) => {
        if (e3) { log('ERROR registering index: ' + e3); process.exit(1); }
        log('  ✓ ' + indexGid);

        globalThis._nodeSearchState = {
          totalNodes: totalNodes,
          nodes: allNodes,
          workers: workers,
        };

        if (args['reset']) {
          resetStores(runPipeline);
        } else {
          runPipeline();
        }
      });
    });
  });
}

function resetStores(callback) {
  log('');
  log('========== RESET: Clearing all stores ==========');
  const gids = [frontierGid, docsGid, indexGid];
  let gi = 0;

  function nextGroup() {
    if (gi >= gids.length) {
      log('All stores cleared.');
      return callback();
    }
    const gid = gids[gi++];
    globalThis.distribution[gid].store.get(null, (err, keys) => {
      if (err || !keys || keys.length === 0) {
        log('  ' + gid + ': empty (skipped)');
        return nextGroup();
      }
      let remaining = keys.length;
      let deleted = 0;
      keys.forEach((key) => {
        globalThis.distribution[gid].store.del(key, (delErr) => {
          if (!delErr) deleted++;
          if (--remaining === 0) {
            log('  ' + gid + ': deleted ' + deleted + '/' + keys.length + ' entries');
            nextGroup();
          }
        });
      });
    });
  }

  nextGroup();
}

function runPipeline() {
  if (args['skip-seed']) {
    log('Skipping seed phase (--skip-seed)');
    return startCrawling();
  }
  phaseSeed();
}

function phaseSeed() {
  log('');
  log('========== PHASE: SEED ==========');
  const frontier = createFrontier(frontierGid);

  seedFrontier(frontier, { batchSize: 100 }, (e, stats) => {
    if (e) log('Seed frontier error: ' + e.message);
    log('Frontier seeded: ' + (stats ? stats.added : 0) + ' URLs added');
    log('Final frontier size: ' + (stats ? stats.frontierSize : 0));
    startCrawling();
  });
}

function startCrawling() {
  if (args['skip-crawl']) {
    log('Skipping crawl phase (--skip-crawl)');
    return startIndexing();
  }
  phaseCrawl();
}

function phaseCrawl() {
  log('');
  log('========== PHASE: CRAWL ==========');
  log('Batch size: ' + crawlBatchSize + ', Rounds: ' + crawlRounds +
    ', Delay: ' + crawlDelay + 'ms');

  const frontier = createFrontier(frontierGid);
  const crawler = createCrawler(frontier, docsGid, {
    batchSize: crawlBatchSize,
    linkFilter: isAllowedUrl,
  });

  let round = 0;
  let totalCrawled = 0;
  let totalErrors = 0;
  let totalLinks = 0;

  function crawlRound() {
    if (round >= crawlRounds) {
      log('Crawl complete: ' + totalCrawled + ' pages, ' +
        totalErrors + ' errors, ' + totalLinks + ' links found');
      return startIndexing();
    }

    round++;
    crawler.crawlBatch((err, stats) => {
      if (err) {
        log('Round ' + round + ' error: ' + err.message);
      } else {
        totalCrawled += stats.crawled || 0;
        totalErrors += stats.errors || 0;
        totalLinks += stats.linksFound || 0;

        if (round % 5 === 0 || round === 1) {
          log('Round ' + round + '/' + crawlRounds +
            ' — crawled=' + totalCrawled +
            ' errors=' + totalErrors +
            ' links=' + totalLinks);
        }

        if (stats.crawled === 0) {
          log('No more URLs to crawl after round ' + round);
          return startIndexing();
        }
      }

      setTimeout(crawlRound, crawlDelay);
    });
  }

  crawlRound();
}

function startIndexing() {
  if (args['skip-index']) {
    log('Skipping index phase (--skip-index)');
    return startServing();
  }
  phaseIndex();
}

function phaseIndex() {
  log('');
  log('========== PHASE: INDEX ==========');

  globalThis.distribution[docsGid].store.get(null, (err, keys) => {
    const docCount = (keys && keys.length) || 100;
    log('Documents to index: ' + docCount);

    runIndexer(docsGid, indexGid, (e, stats) => {
      if (e) {
        log('Indexer error: ' + e);
        return startServing();
      }
      log('Index built: ' + stats.terms + ' terms from ' +
        stats.docs + ' docs in ' + stats.elapsed + 'ms');

      globalThis._nodeSearchState.totalDocs = docCount;
      startServing();
    });
  });
}

function startServing() {
  log('');
  log('========== PHASE: SERVE ==========');
  const totalDocs = (globalThis._nodeSearchState &&
    globalThis._nodeSearchState.totalDocs) || 1000;

  startFrontend({
    port: frontendPort,
    indexGid: indexGid,
    docsGid: docsGid,
    frontierGid: frontierGid,
    totalDocs: totalDocs,
  }, (err, server) => {
    if (err) {
      log('Frontend error: ' + err.message);
      process.exit(1);
    }
    log('');
    log('================================================');
    log('  NodeSearch is live!');
    log('  Search UI: http://' + coordCfg.ip + ':' + frontendPort);
    log('  API:       http://' + coordCfg.ip + ':' + frontendPort + '/search?q=...');
    log('  Status:    http://' + coordCfg.ip + ':' + frontendPort + '/status');
    log('================================================');
    log('');
    log('Press Ctrl+C to stop.');

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    function shutdown() {
      log('Shutting down...');
      server.close(() => {
        distribution.node.server.close(() => {
          process.exit(0);
        });
      });
    }
  });
}

#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const readline = require('readline');
process.chdir(path.resolve(__dirname, '../..'));

const yargs = require('yargs/yargs');
const args = yargs(process.argv.slice(2))
  .option('cluster', { type: 'string', demandOption: true, describe: 'Path to nodes.json' })
  .option('q', { type: 'string', describe: 'Single query (non-interactive)' })
  .option('n', { type: 'number', default: 10, describe: 'Max results' })
  .help()
  .parse();

if (!args.cluster) {
  console.error('Error: --cluster requires a path to nodes.json');
  process.exit(1);
}
const configPath = path.resolve(args.cluster);
if (!fs.existsSync(configPath) || fs.statSync(configPath).isDirectory()) {
  console.error('Config not found (or is a directory):', configPath);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const coordCfg = config.coordinator;
const workerCfgs = config.workers || [];
const groupNames = config.groups || {};
const indexGid = groupNames.index || 'ns-index';

const cliPort = 20000 + Math.floor(Math.random() * 10000);
const distribution = require('../../distribution.js')({ ip: '0.0.0.0', port: cliPort });
const id = distribution.util.id;
const { registerGroup } = require('./cluster.js');
const { search } = require('./query.js');

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function pingWorkers(workers, callback) {
  const alive = [];
  let pending = workers.length;
  const handled = new Set();
  if (pending === 0) return callback(alive);

  workers.forEach((w, idx) => {
    const timeout = setTimeout(() => {
      if (handled.has(idx)) return;
      handled.add(idx);
      if (--pending === 0) callback(alive);
    }, 5000);

    distribution.local.comm.send(
      ['nid'], { node: w, service: 'status', method: 'get' },
      (err) => {
        clearTimeout(timeout);
        if (handled.has(idx)) return;
        handled.add(idx);
        if (!err) alive.push(w);
        if (--pending === 0) callback(alive);
      },
    );
  });
}

function formatResult(r, rank) {
  const lines = [];
  lines.push(
    `  ${BOLD}${CYAN}${rank}.${RESET} ${BOLD}${r.url}${RESET}`,
  );

  const meta = [];
  if (r.repoOwner) meta.push(`${YELLOW}${r.repoOwner}${RESET}`);
  if (r.lastCommitDate) meta.push(`${DIM}${r.lastCommitDate}${RESET}`);
  meta.push(`${GREEN}score: ${r.score}${RESET}`);
  lines.push(`     ${meta.join('  ')}`);

  if (r.matchedTerms && r.matchedTerms.length > 0) {
    lines.push(`     ${DIM}terms: ${r.matchedTerms.join(', ')}${RESET}`);
  }
  if (r.breakdown) {
    const b = r.breakdown;
    lines.push(
      `     ${DIM}tfidf:${b.tfidf} pr:${b.pagerank_global} ` +
      `owner:${b.pagerank_repoOwner} rec:${b.recency}${RESET}`,
    );
  }
  return lines.join('\n');
}

function doSearch(query, topN, callback) {
  const totalDocs = (globalThis._nodeSearchState &&
    globalThis._nodeSearchState.totalDocs) || 1000;
  search(query, indexGid, { topN: topN, totalDocs: totalDocs }, (err, data) => {
    if (err) {
      console.error(`${BOLD}Error:${RESET} ${err.message}`);
      return callback();
    }
    console.log('');
    if (!data.results || data.results.length === 0) {
      console.log(`  No results for "${query}" ${DIM}(${data.elapsed}ms)${RESET}`);
      console.log('');
      return callback();
    }
    console.log(
      `  ${BOLD}${data.totalMatches}${RESET} results for ` +
      `"${CYAN}${data.query}${RESET}" ${DIM}(${data.elapsed}ms, ` +
      `terms: ${data.terms.join(', ')})${RESET}`,
    );
    console.log('');
    data.results.forEach((r, i) => {
      console.log(formatResult(r, i + 1));
      console.log('');
    });
    callback();
  });
}

process.stderr.write(`${DIM}Connecting to cluster...${RESET}\n`);

distribution.node.start((err) => {
  if (err) {
    console.error('Failed to start node:', err.message);
    process.exit(1);
  }
  distribution.node.config.ip = coordCfg.ip;

  pingWorkers(workerCfgs, (alive) => {
    if (alive.length === 0) {
      console.error('No workers reachable. Are they running?');
      process.exit(1);
    }
    process.stderr.write(
      `${DIM}${alive.length}/${workerCfgs.length} workers online${RESET}\n`,
    );

    const allNodes = {};
    alive.forEach((w) => { allNodes[id.getSID(w)] = w; });

    registerGroup(indexGid, id.rendezvousHash, allNodes, (e) => {
      if (e) {
        console.error('Failed to register index group:', e);
        process.exit(1);
      }

      globalThis.distribution[indexGid].store.get(null, (getErr, keys) => {
        const docCount = (keys && Array.isArray(keys)) ? keys.length : 1000;
        globalThis._nodeSearchState = { totalDocs: Math.max(docCount, 100) };
        process.stderr.write(
          `${DIM}Index ready (${docCount} terms)${RESET}\n`,
        );

        if (args.q) {
          doSearch(args.q, args.n, () => process.exit(0));
        } else {
          startRepl();
        }
      });
    });
  });
});

function startRepl() {
  console.log('');
  console.log(`${BOLD}  Node${CYAN}Search${RESET}${BOLD} CLI${RESET}`);
  console.log(`${DIM}  Type a query and press Enter. Ctrl+C to exit.${RESET}`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${BLUE}search>${RESET} `,
  });

  rl.prompt();

  rl.on('line', (line) => {
    const q = line.trim();
    if (!q) { rl.prompt(); return; }
    if (q === 'exit' || q === 'quit' || q === ':q') {
      rl.close();
      return;
    }
    doSearch(q, args.n, () => rl.prompt());
  });

  rl.on('close', () => {
    console.log('');
    process.exit(0);
  });
}

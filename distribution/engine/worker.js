#!/usr/bin/env node

const path = require('path');
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
      console.log(`[worker] Freed port ${port} (killed PID(s): ${pids.replace(/\n/g, ', ')})`);
    }
  } catch (_) { }
}

const yargs = require('yargs/yargs');
const args = yargs(process.argv.slice(2))
  .option('ip', { type: 'string', demandOption: true, describe: 'Announced IP (used for node identity and routing)' })
  .option('port', { type: 'number', default: 7800, describe: 'Port to listen on' })
  .help()
  .parse();

freePort(args.port);

const distribution = require('../../distribution.js')({ ip: '0.0.0.0', port: args.port });

console.log('[worker] Starting on ' + args.ip + ':' + args.port + '...');

distribution.node.start((err) => {
  if (err) {
    console.error('[worker] Failed to start:', err.message);
    process.exit(1);
  }

  distribution.node.config.ip = args.ip;

  const sid = distribution.util.id.getSID(distribution.node.config);
  console.log('[worker] ✓ Running as ' + sid + ' on ' + args.ip + ':' + args.port);
  console.log('[worker] Waiting for coordinator to register groups...');

  setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    console.log('[worker] heartbeat — heap=' + heapMB + 'MB');
  }, 60000);

  process.on('SIGTERM', () => {
    console.log('[worker] SIGTERM received, shutting down...');
    distribution.node.server.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    console.log('[worker] SIGINT received, shutting down...');
    distribution.node.server.close(() => process.exit(0));
  });
});

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="${REPO_ROOT}/nodes.json"

SSH_KEY=""
SSH_USER="ec2-user"
WORKERS_ONLY=false
REPO_DIR="/home/ec2-user/stencil"

while [[ $# -gt 0 ]]; do
  case $1 in
    --key)          SSH_KEY="-i $2"; shift 2 ;;
    --user)         SSH_USER="$2"; shift 2 ;;
    --workers-only) WORKERS_ONLY=true; shift ;;
    --dir)          REPO_DIR="$2"; shift 2 ;;
    --config)       CONFIG="$2"; shift 2 ;;
    *)              echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ ! -f "$CONFIG" ]; then
  echo "Config not found: $CONFIG"
  exit 1
fi

COORD_IP=$(node -e "console.log(require('$CONFIG').coordinator.ip)")
COORD_PORT=$(node -e "console.log(require('$CONFIG').coordinator.port)")
FRONTEND_PORT=$(node -e "console.log(require('$CONFIG').coordinator.frontendPort || 3000)")
REPO_URL=$(node -e "console.log((require('$CONFIG').git||{}).repo || 'https://github.com/jiminleeryu/1380.git')")
REPO_BRANCH=$(node -e "console.log((require('$CONFIG').git||{}).branch || 'main')")
WORKER_COUNT=$(node -e "console.log(require('$CONFIG').workers.length)")

echo "========================================"
echo "  NodeSearch Cluster Deployment"
echo "========================================"
echo "  Coordinator: $COORD_IP:$COORD_PORT"
echo "  Workers:     $WORKER_COUNT"
echo "  Repo:        $REPO_URL ($REPO_BRANCH)"
echo "  SSH user:    $SSH_USER"
echo "========================================"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

setup_remote() {
  local ip=$1
  local port=$2
  local role=$3

  echo ""
  echo "--- Setting up $role: $ip:$port ---"

  # shellcheck disable=SC2086
  ssh $SSH_OPTS $SSH_KEY "${SSH_USER}@${ip}" bash -s -- \
    --start --ip "$ip" --port "$port" \
    --repo "$REPO_URL" --branch "$REPO_BRANCH" --dir "$REPO_DIR" \
    < "$REPO_ROOT/scripts/setup-node.sh"

  echo "--- $role $ip:$port ready ---"
}

echo ""
echo "========== Deploying Workers =========="

PIDS=()
for i in $(seq 0 $((WORKER_COUNT - 1))); do
  W_IP=$(node -e "console.log(require('$CONFIG').workers[$i].ip)")
  W_PORT=$(node -e "console.log(require('$CONFIG').workers[$i].port)")

  setup_remote "$W_IP" "$W_PORT" "worker-$i" &
  PIDS+=($!)
done

FAILED=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    ((FAILED++))
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "WARNING: $FAILED worker(s) failed to deploy."
  echo "The coordinator will skip unreachable workers."
fi

echo ""
echo "========== Workers Deployed =========="

if [ "$WORKERS_ONLY" = true ]; then
  echo ""
  echo "Workers deployed. Start the coordinator manually:"
  echo "  ssh ${SSH_USER}@${COORD_IP} 'cd $REPO_DIR && node distribution/engine/coordinator.js --cluster nodes.json'"
  exit 0
fi

echo ""
echo "========== Starting Coordinator =========="

echo "Setting up coordinator code..."
# shellcheck disable=SC2086
ssh $SSH_OPTS $SSH_KEY "${SSH_USER}@${COORD_IP}" bash -s -- \
  --repo "$REPO_URL" --branch "$REPO_BRANCH" --dir "$REPO_DIR" \
  < "$REPO_ROOT/scripts/setup-node.sh"

echo "Starting coordinator process..."
# shellcheck disable=SC2086
ssh $SSH_OPTS $SSH_KEY "${SSH_USER}@${COORD_IP}" \
  "cd $REPO_DIR && nohup node distribution/engine/coordinator.js --cluster nodes.json > coordinator.log 2>&1 &"

echo ""
echo "================================================"
echo "  Deployment complete!"
echo "  Search UI:  http://localhost:${FRONTEND_PORT}"
echo "  Logs:       ssh ${SSH_USER}@${COORD_IP} 'tail -f ${REPO_DIR}/coordinator.log'"
echo "================================================"

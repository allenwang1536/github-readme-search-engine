#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/jiminleeryu/1380.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_DIR="${REPO_DIR:-/home/ec2-user/stencil}"
NODE_IP="${NODE_IP:-}"
NODE_PORT="${NODE_PORT:-7800}"
START_WORKER=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --start)   START_WORKER=true; shift ;;
    --ip)      NODE_IP="$2"; shift 2 ;;
    --port)    NODE_PORT="$2"; shift 2 ;;
    --repo)    REPO_URL="$2"; shift 2 ;;
    --branch)  REPO_BRANCH="$2"; shift 2 ;;
    --dir)     REPO_DIR="$2"; shift 2 ;;
    *)         echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "========================================"
echo "  NodeSearch EC2 Node Setup"
echo "========================================"

if ! command -v git &> /dev/null; then
  echo "[setup] Installing git..."
  if command -v yum &> /dev/null; then
    sudo yum install -y git 2>&1 | tail -1
  elif command -v apt-get &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq git 2>&1 | tail -1
  else
    echo "[setup] ERROR: No package manager found. Install git manually."
    exit 1
  fi
fi

if ! command -v node &> /dev/null; then
  echo "[setup] Node.js not found, installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  echo "[setup] Node.js $(node --version) installed"
else
  echo "[setup] Node.js $(node --version) already installed"
fi

if [ -d "$REPO_DIR/.git" ]; then
  echo "[setup] Repository exists at $REPO_DIR, pulling latest..."
  cd "$REPO_DIR"
  git fetch origin
  git checkout "$REPO_BRANCH"
  git reset --hard "origin/$REPO_BRANCH"
  echo "[setup] Updated to latest $(git --no-pager log --oneline -1)"
else
  echo "[setup] Cloning repository..."
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
  echo "[setup] Cloned $(git --no-pager log --oneline -1)"
fi

echo "[setup] Installing npm dependencies..."
npm install --production 2>&1 | tail -3
echo "[setup] Dependencies installed"

echo "[setup] Cleaning stale store data..."
rm -rf "$REPO_DIR/store/"

if [ "$START_WORKER" = true ]; then
  if [ -z "$NODE_IP" ]; then
    TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null || true)
    if [ -n "$TOKEN" ]; then
      NODE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
        http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null || true)
    fi
    if [ -z "$NODE_IP" ]; then
      NODE_IP=$(hostname -I | awk '{print $1}')
    fi
    echo "[setup] Auto-detected IP: $NODE_IP"
  fi

  if [ -z "$NODE_IP" ]; then
    echo "[setup] ERROR: Could not determine node IP. Use --ip flag."
    exit 1
  fi

  EXISTING_PID=$(pgrep -f "node.*worker.js.*--port $NODE_PORT" || true)
  if [ -n "$EXISTING_PID" ]; then
    echo "[setup] Stopping existing worker (PID $EXISTING_PID)..."
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 1
  fi

  echo "[setup] Starting worker on $NODE_IP:$NODE_PORT..."
  nohup node "$REPO_DIR/distribution/engine/worker.js" \
    --ip "$NODE_IP" --port "$NODE_PORT" \
    > "$REPO_DIR/worker.log" 2>&1 &

  WORKER_PID=$!
  echo "[setup] Worker started (PID $WORKER_PID)"

  sleep 2
  if kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[setup] ✓ Worker is running on $NODE_IP:$NODE_PORT"
  else
    echo "[setup] ✗ Worker failed to start. Check worker.log:"
    tail -20 "$REPO_DIR/worker.log"
    exit 1
  fi
fi

echo "[setup] Done."

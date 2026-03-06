#!/usr/bin/env bash
# deploy.sh — build and redeploy
# Usage:
#   ./deploy.sh          # full rebuild (frontend changed)
#   ./deploy.sh --quick  # restart only (backend Python changed)
set -e

REMOTE=nano
REMOTE_DIR='/home/alex/rover-dashboard'

# When running directly on the Nano, skip rsync and use docker compose locally.
# When running from the Mac, rsync first then SSH.
if [[ "$(hostname)" == "nano" ]]; then
  cd "$REMOTE_DIR"
  if [[ "$1" == "--quick" ]]; then
    echo "→ Restarting container (no rebuild)..."
    docker compose restart dashboard
  else
    echo "→ Building and redeploying..."
    docker compose up -d --build
  fi
  echo "→ Health check..."
  sleep 2
  curl -s http://localhost:8765/api/health
else
  rsync -av --exclude='.git' --exclude='node_modules' --exclude='frontend/node_modules' \
            --exclude='__pycache__' --exclude='*.pyc' --exclude='backend/static' \
            . "$REMOTE:$REMOTE_DIR/"
  if [[ "$1" == "--quick" ]]; then
    echo "→ Restarting container (no rebuild)..."
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose restart dashboard"
  else
    echo "→ Building and redeploying..."
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d --build"
  fi
  echo "→ Health check..."
  sleep 2
  ssh "$REMOTE" "curl -s http://localhost:8765/api/health"
fi

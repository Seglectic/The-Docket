#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/the-docket"
SERVICE_NAME="the-docket.service"
BRANCH="${1:-main}"

cd "$APP_DIR"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
npm ci --omit=dev
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl is-active --quiet "$SERVICE_NAME"

echo "Deployed $(git rev-parse HEAD) on $(hostname)"

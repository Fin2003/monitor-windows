#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

engine_dir=linux-x64
if [[ "$(uname -m)" == "aarch64" ]]; then
  engine_dir=linux-arm64
fi

if [[ ! -x "plugins/system-monitor/engine/${engine_dir}/SystemMonitorEngine" ]]; then
  echo "[Monitor] Linux hardware engine is missing. Run: npm run build:engine:linux"
  exit 1
fi

if [[ ! -f dist/manager.html ]]; then
  echo "[Monitor] Building for first time..."
  npm run build
fi

echo "[Monitor] Starting..."
exec npx electron .

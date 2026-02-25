#!/usr/bin/env bash
# Soma dev environment — hardcoded ports
# Web:  http://localhost:3456
# Sync: runs on-demand (no persistent server)

set -euo pipefail
cd "$(dirname "$0")"

# Kill any existing processes on our port
lsof -i :3456 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

echo "Starting Soma dev server on http://localhost:3456 ..."
cd web && npm run dev

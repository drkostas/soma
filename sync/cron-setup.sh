#!/bin/bash
# Soma Sync — Cron Setup Helper
# Adds an hourly sync job to the current user's crontab.
# Run: bash sync/cron-setup.sh

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYNC_DIR="$REPO_DIR/sync"
PYTHON="$SYNC_DIR/.venv/bin/python"
LOG_FILE="/tmp/soma-sync.log"

# Verify python exists
if [ ! -f "$PYTHON" ]; then
    echo "Error: Python venv not found at $PYTHON"
    echo "Run: cd $SYNC_DIR && python3 -m venv .venv && .venv/bin/pip install -e ."
    exit 1
fi

CRON_LINE="0 * * * * cd $SYNC_DIR && $PYTHON -m src.pipeline 1 >> $LOG_FILE 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -q "soma-sync\|src.pipeline"; then
    echo "Cron job already exists. Current crontab:"
    crontab -l | grep "pipeline"
    exit 0
fi

# Add to crontab (preserving existing entries)
(crontab -l 2>/dev/null; echo "# soma-sync: hourly health data sync"; echo "$CRON_LINE") | crontab -

echo "Cron job installed! Syncs every hour on the hour."
echo "Log file: $LOG_FILE"
echo ""
echo "Verify with: crontab -l"
echo "Remove with: crontab -e  (delete the soma-sync lines)"

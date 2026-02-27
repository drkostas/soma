#!/usr/bin/env bash
# Soma sync is now handled by GitHub Actions (every 4 hours + on-demand via Sync Now button).
# A local cron job is no longer needed or recommended — it would cause double-syncs
# and waste Neon DB network transfer.
#
# The GitHub Actions workflow is at: .github/workflows/sync.yml
#
# To trigger a manual sync immediately:
#   - Use the "Sync Now" button on the Connections page (soma.gkos.dev/connections)
#   - Or via GitHub CLI: gh workflow run sync.yml --repo drkostas/soma
#   - Or via API: POST https://api.github.com/repos/drkostas/soma/dispatches
#                  with body: {"event_type":"sync-trigger"}
#                  and header: Authorization: Bearer <GITHUB_PAT>

echo "Soma sync is managed by GitHub Actions (.github/workflows/sync.yml)."
echo "No local cron job needed. Use the Sync Now button at soma.gkos.dev/connections."

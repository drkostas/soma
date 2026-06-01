#!/bin/bash
# soma-tunnel-watch.sh
# Watches cloudflared's stderr log for the assigned trycloudflare.com URL
# and, whenever it changes, updates Vercel's SOMA_CHAT_TUNNEL_URL env var
# on the soma-personal project and triggers a production redeploy.
#
# Why: Quick Tunnels rotate the URL on disconnect (Mac sleep, network drop,
# tunnel daemon restart). Without this watcher, the Vercel proxy keeps
# pointing at the old URL and chat 502s until manually updated.
#
# Loaded by ~/Library/LaunchAgents/dev.gkos.soma.tunnel-watch.plist.

set -u

LOG="/Users/gkos/Library/Logs/soma/tunnel.err.log"
STATE_FILE="/Users/gkos/Library/Logs/soma/tunnel-current-url.txt"
VERCEL="/opt/homebrew/bin/vercel"
SOMA_DIR="/Users/gkos/Insync/Gdrive/Projects/soma"
VERCEL_PROJECT_DIR="$SOMA_DIR"  # vercel CLI honors --cwd from project root
LOG_OUT="/Users/gkos/Library/Logs/soma/tunnel-watch.out.log"

# Wait for the log file to exist.
while [ ! -f "$LOG" ]; do
  echo "$(date -u +%FT%TZ) waiting for $LOG" >> "$LOG_OUT"
  sleep 5
done

echo "$(date -u +%FT%TZ) watcher started" >> "$LOG_OUT"

# Tail the log and react to every new URL line. The URL appears in lines like:
#   |  https://random-words.trycloudflare.com                                   |
# at startup. We just match the host.
/usr/bin/tail -F "$LOG" 2>/dev/null | while IFS= read -r line; do
  url=$(echo "$line" | /usr/bin/grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | /usr/bin/head -1)
  [ -z "$url" ] && continue

  # Skip if URL hasn't changed since last sync.
  if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$url" ]; then
    continue
  fi

  echo "$(date -u +%FT%TZ) new tunnel URL: $url" >> "$LOG_OUT"

  # Update Vercel production env (idempotent: rm-then-add).
  cd "$VERCEL_PROJECT_DIR/web" || { echo "cd failed" >> "$LOG_OUT"; continue; }
  "$VERCEL" env rm SOMA_CHAT_TUNNEL_URL production --yes >>"$LOG_OUT" 2>&1
  echo "$url" | "$VERCEL" env add SOMA_CHAT_TUNNEL_URL production >>"$LOG_OUT" 2>&1

  # Redeploy so the functions pick up the new env var.
  cd "$VERCEL_PROJECT_DIR" || continue
  "$VERCEL" deploy --prod --yes >>"$LOG_OUT" 2>&1 \
    && echo "$(date -u +%FT%TZ) redeploy ok" >> "$LOG_OUT" \
    || echo "$(date -u +%FT%TZ) redeploy FAILED" >> "$LOG_OUT"

  echo "$url" > "$STATE_FILE"
done

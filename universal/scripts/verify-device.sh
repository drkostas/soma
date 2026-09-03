#!/usr/bin/env bash
# verify-device.sh — the T0 gate: is <screen> rendering REAL data from the real
# API on a real device (the Android emulator with the owner's account, or the phone)?
#
# "Done is derived, never asserted." This script IS the observation. Exit 0 only
# when the device shows a marker value fetched live from the API right now.
#
# Usage:
#   universal/scripts/verify-device.sh overview            # auto marker: today's steps
#   universal/scripts/verify-device.sh overview --activities   # auto marker: lifetime activity count
#   universal/scripts/verify-device.sh running --marker "202 runs"   # explicit marker
#   ANDROID_SERIAL=100.99.159.74:5555 universal/scripts/verify-device.sh overview   # the phone
#
# Needs: ~/.config/soma/app.env (EXPO_PUBLIC_API_URL + EXPO_PUBLIC_API_TOKEN, chmod 600,
#        NEVER committed), the app (dev.gkos.soma) built against that URL and installed,
#        Android SDK platform-tools, Maestro (~/.maestro/bin/maestro).
set -euo pipefail

SCREEN="${1:-overview}"; shift || true
MODE="auto"; MARKER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER="$2"; MODE="explicit"; shift 2;;
    --activities) MODE="activities"; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

DEV="${ANDROID_SERIAL:-emulator-5554}"
ENVF="$HOME/.config/soma/app.env"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
MAESTRO="$HOME/.maestro/bin/maestro"
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # universal/
FLOW="$HERE/.maestro/verify-screen.yaml"
OUT="/tmp/soma/verify"; mkdir -p "$OUT"

[ -f "$ENVF" ] || { echo "FAIL: missing $ENVF (API url + token by reference)"; exit 2; }
set -a; . "$ENVF"; set +a
: "${EXPO_PUBLIC_API_URL:?}"; : "${EXPO_PUBLIC_API_TOKEN:?}"
[ -x "$ADB" ] || { echo "FAIL: adb not at $ADB"; exit 2; }
[ -x "$MAESTRO" ] || { echo "FAIL: maestro not at $MAESTRO"; exit 2; }
# Maestro 2.x needs Java 17+. A non-interactive shell on this Mac defaults to JDK 8
# (drlab gotcha), so pin it here rather than trusting the caller's environment.
export JAVA_HOME="${JAVA_HOME_17:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
"$JAVA_HOME/bin/java" -version 2>&1 | grep -qE 'version "(1[7-9]|[2-9][0-9])' \
  || { echo "FAIL: Java 17+ not found at $JAVA_HOME (maestro cannot run)"; exit 2; }

# 1. Device up, app installed.
STATE="$($ADB -s "$DEV" get-state 2>/dev/null || true)"
[ "$STATE" = "device" ] || { echo "FAIL: $DEV state='$STATE' (not up)"; exit 2; }
$ADB -s "$DEV" shell pm list packages 2>/dev/null | grep -q "dev.gkos.soma" \
  || { echo "FAIL: dev.gkos.soma not installed on $DEV"; exit 2; }

# 2. The marker: a value the screen must render, fetched LIVE from the real API.
api() { curl -sf -H "Authorization: Bearer $EXPO_PUBLIC_API_TOKEN" "$EXPO_PUBLIC_API_URL$1"; }
case "$MODE" in
  auto)
    case "$SCREEN" in
      overview)
        MARKER="$(api /api/health/today | python3 -c 'import json,sys;v=json.load(sys.stdin).get("total_steps");print(f"{int(v):,}" if v is not None else "")')";;
      *) echo "FAIL: no auto marker for '$SCREEN' — pass --marker TEXT"; exit 2;;
    esac;;
  activities)
    MARKER="$(api /api/overview/fitness | python3 -c 'import json,sys;v=json.load(sys.stdin).get("total_activities");print(f"{int(v):,}" if v is not None else "")')";;
  explicit) ;;
esac
[ -n "$MARKER" ] || { echo "FAIL: could not resolve a marker from the API for '$SCREEN'"; exit 2; }
echo "verify $SCREEN on $DEV — expecting live marker: '$MARKER'  (from $EXPO_PUBLIC_API_URL)"

# 3. Drive the device: open the screen, wait for the marker to be visible.
set +e
( cd "$HERE" && "$MAESTRO" --device "$DEV" test \
    -e ROUTE="universal://$SCREEN" -e MARKER="$MARKER" -e SCREEN="$SCREEN" \
    "$FLOW" ) > "$OUT/$SCREEN.maestro.log" 2>&1
RC=$?
set -e

# 4. Keep the evidence regardless of outcome.
$ADB -s "$DEV" exec-out screencap -p > "$OUT/$SCREEN.png" 2>/dev/null || true
if [ $RC -eq 0 ]; then
  echo "VERIFIED $SCREEN: '$MARKER' visible on $DEV — evidence $OUT/$SCREEN.png"
  exit 0
fi
# Distinguish "the harness could not run" from "the screen did not show the marker".
# An infra failure must never masquerade as a verification result (exit 2 vs 1).
if grep -qiE "Java 17|No devices|Unable to connect|not found|Failed to connect|maestro: command" "$OUT/$SCREEN.maestro.log"; then
  echo "HARNESS ERROR $SCREEN (not a verification result): maestro could not run — see $OUT/$SCREEN.maestro.log"
  grep -iE "Java 17|No devices|Unable to connect|not found|Failed to connect" "$OUT/$SCREEN.maestro.log" | head -3
  exit 2
fi
echo "FAILED $SCREEN (maestro rc=$RC): '$MARKER' NOT seen on $DEV — see $OUT/$SCREEN.maestro.log and $OUT/$SCREEN.png"
tail -15 "$OUT/$SCREEN.maestro.log"
exit 1

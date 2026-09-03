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
#   universal/scripts/verify-device.sh playlist-builder --flow .maestro/verify-builder-save.yaml --marker "On Spotify" --env "RUN=Athens Running"   # a mutation flow
#   ANDROID_SERIAL=100.99.159.74:5555 universal/scripts/verify-device.sh overview   # the phone
#
# Needs: ~/.config/soma/app.env (EXPO_PUBLIC_API_URL + EXPO_PUBLIC_API_TOKEN, chmod 600,
#        NEVER committed), the app (dev.gkos.soma) built against that URL and installed,
#        Android SDK platform-tools, Maestro (~/.maestro/bin/maestro).
set -euo pipefail

SCREEN="${1:-overview}"; shift || true
MODE="auto"; MARKER=""; DRY=0; FLOW_OVERRIDE=""; EXTRA_ENV=()
while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER="$2"; MODE="explicit"; shift 2;;
    --activities) MODE="activities"; shift;;
    --dry) DRY=1; shift;;
    --flow) FLOW_OVERRIDE="$2"; shift 2;;            # run this Maestro flow instead of verify-screen.yaml (relative to universal/)
    --env) EXTRA_ENV+=(-e "$2"); shift 2;;            # extra -e KEY=VALUE for the flow (repeatable)                       # resolve + print the marker, don't touch the device
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
if [ "$DRY" = 1 ]; then
  api() { curl -sf -m 30 -H "Authorization: Bearer $EXPO_PUBLIC_API_TOKEN" "$EXPO_PUBLIC_API_URL$1"; }
fi
[ "$DRY" = 1 ] || [ -x "$ADB" ] || { echo "FAIL: adb not at $ADB"; exit 2; }
[ "$DRY" = 1 ] || [ -x "$MAESTRO" ] || { echo "FAIL: maestro not at $MAESTRO"; exit 2; }
# Maestro 2.x needs Java 17+. A non-interactive shell on this Mac defaults to JDK 8
# (drlab gotcha), so pin it here rather than trusting the caller's environment.
export JAVA_HOME="${JAVA_HOME_17:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
[ "$DRY" = 1 ] || "$JAVA_HOME/bin/java" -version 2>&1 | grep -qE 'version "(1[7-9]|[2-9][0-9])' \
  || { echo "FAIL: Java 17+ not found at $JAVA_HOME (maestro cannot run)"; exit 2; }

# 1. Device up, app installed.
if [ "$DRY" = 1 ]; then STATE=device; else
STATE="$($ADB -s "$DEV" get-state 2>/dev/null || true)"
[ "$STATE" = "device" ] || { echo "FAIL: $DEV state='$STATE' (not up)"; exit 2; }
$ADB -s "$DEV" shell pm list packages 2>/dev/null | grep -q "dev.gkos.soma" \
  || { echo "FAIL: dev.gkos.soma not installed on $DEV"; exit 2; }
fi

# 1b. The screen must be on and unlocked (the phone dozes; the emulator does not).
if [ "$DRY" != 1 ]; then
  WAKE="$($ADB -s "$DEV" shell dumpsys power 2>/dev/null | grep -oE 'mWakefulness=[A-Za-z]+' | head -1)"
  case "$WAKE" in *Awake*) ;; *) $ADB -s "$DEV" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1;; esac
  if $ADB -s "$DEV" shell dumpsys window 2>/dev/null | grep -qE 'mCurrentFocus=.*(NotificationShade|Keyguard|StatusBar)'; then
    $ADB -s "$DEV" shell input keyevent KEYCODE_MENU >/dev/null 2>&1; sleep 1     # dismisses a swipe-only lockscreen
    $ADB -s "$DEV" shell input swipe 540 1800 540 600 300 >/dev/null 2>&1; sleep 1
    if $ADB -s "$DEV" shell dumpsys window 2>/dev/null | grep -qE 'mCurrentFocus=.*(NotificationShade|Keyguard|StatusBar)'; then
      echo "HARNESS ERROR $SCREEN (not a verification result): $DEV is locked with a secure lock — unlock the phone, then re-run"; exit 2
    fi
  fi
fi

# 1c. Never hijack a phone that is in use. If a third-party app is in the foreground (not soma,
# not the launcher, not the lockscreen) the owner is using it — e.g. Maps while driving — and a
# deep link would pull soma over it. That is a harness error, and it says why.
# (An emulator has no person using it — the guard is for physical devices only.)
if [ "$DRY" != 1 ] && [ "${DEV#emulator-}" = "$DEV" ]; then
  FG="$($ADB -s "$DEV" shell dumpsys window 2>/dev/null | grep -oE 'mCurrentFocus=Window\{[^}]*\}' | head -1 | sed -E 's/.* ([a-zA-Z0-9_.]+)\/.*/\1/')"
  case "$FG" in ""|dev.gkos.soma|*launcher*|*Launcher*|*nexuslauncher*|*home*) ;;
    *) echo "HARNESS ERROR $SCREEN (not a verification result): $DEV is in use ($FG is in the foreground) — not taking it over; re-run when the phone is free"; exit 2;;
  esac
fi

# 2. The marker: a value the screen must render, fetched LIVE from the real API.
api() { curl -sf -m 30 -H "Authorization: Bearer $EXPO_PUBLIC_API_TOKEN" "$EXPO_PUBLIC_API_URL$1"; }
# One marker per screen, formatted EXACTLY as the screen formats it (JS toFixed = round
# half-up on the binary value, Math.round = floor(x+0.5), toLocaleString = thousands
# commas). A marker that cannot be derived is exit 2 — never a "pass".
# (Python source is single-quoted for bash, so it uses double quotes only.)
MARKERS_PY='
import json, sys, math, datetime
from decimal import Decimal, ROUND_HALF_UP
TODAY = datetime.date.today().isoformat()
def fixed(x, n):                     # JS Number.prototype.toFixed(n)
    q = Decimal(1).scaleb(-n)
    v = Decimal(x).quantize(q, rounding=ROUND_HALF_UP)
    return str(v) if n else str(int(v))
def jsround(x):                      # JS Math.round
    return int(math.floor(float(x) + 0.5))
def fmt_int(v):                      # Number.toLocaleString()
    return "{:,}".format(int(v))
def first_run(d):
    r = (d if isinstance(d, list) else d.get("runs", []))[0]
    n = r.get("activity_name")
    if n not in (None, "", "Run"):
        return n
    return "{} km · {} min".format(fixed(r["distance"] / 1000, 1), jsround(r["duration"] / 60))
def sync_records(d):
    src = d.get("sources") or {}
    vals = src.values() if isinstance(src, dict) else src
    return fmt_int(sum(int((x.get("records") if isinstance(x, dict) else 0) or 0) for x in vals))
S = {
  "overview":         ("/api/health/today",                    lambda d: fmt_int(d["total_steps"])),
  "activities-total": ("/api/overview/fitness",                lambda d: fmt_int(d["total_activities"])),
  "nutrition":        ("/api/nutrition/plan?date=" + TODAY,    lambda d: "Copy yesterday" if d.get("plan") is None else fmt_int(d["remaining"]["calories"])),
  "running":          ("/api/running/stats?range=6m",          lambda d: "{} runs · {} km".format(d["stats"]["total_runs"], fixed(d["stats"]["total_km"], 0))),
  "workouts":         ("/api/workouts/insights?range=6m",      lambda d: "{} workouts logged".format(len(d["calendar"]))),
  "sleep":            ("/api/stats/sleep?range=90d",           lambda d: "{}h–{}h".format(fixed(d["summary"]["current_min"], 1), fixed(d["summary"]["current_max"], 1))),
  "activities":       ("/api/activities/summary?range=6m",     lambda d: fmt_int(jsround(d["totals"]["cal"]))),
  "training":         ("/api/training/breakdown?date=" + TODAY, lambda d: "Readiness {}".format(d["readiness"]["traffic_light"])),
  "connections":      ("/api/sync/status",                     sync_records),
  "playlist":         ("/api/playlist/spotify/library",        lambda d: fmt_int(d["total_tracks"])),
  "playlist-builder": ("/api/playlist/garmin-runs?limit=50",   first_run),
  "live-dj":          ("/api/playlist/dj/hr-defaults",         lambda d: "Garmin" if (d.get("hr_rest") or d.get("hr_max")) else ""),
  "more":             (None,                                   lambda d: "BPM-matched running playlists"),   # static screen: navigation checkpoint only
}
mode, screen = sys.argv[1], sys.argv[2]
if screen not in S:
    sys.exit(3)
ep, fn = S[screen]
if mode == "ep":
    print(ep or ""); sys.exit(0)
d = json.load(sys.stdin) if ep else {}
try:
    print(fn(d))
except Exception as e:
    sys.stderr.write("marker expr failed for {}: {!r}\n".format(screen, e)); sys.exit(4)
'
marker_for() { # screen → prints the marker; rc 1 = unknown screen, rc 4 = API shape mismatch
  local ep; ep="$(python3 -c "$MARKERS_PY" ep "$1")" || return 1
  if [ -z "$ep" ]; then python3 -c "$MARKERS_PY" fmt "$1" <<<'{}'; return; fi
  api "$ep" | python3 -c "$MARKERS_PY" fmt "$1"
}
case "$MODE" in
  auto)       MARKER="$(marker_for "$SCREEN")" || { echo "FAIL: could not derive a marker for '$SCREEN' (rc=$?) — unknown screen or API shape changed; pass --marker TEXT"; exit 2; };;
  activities) MARKER="$(marker_for activities-total)";;
  explicit) ;;
esac
[ -n "$MARKER" ] || { echo "FAIL: could not resolve a marker from the API for '$SCREEN'"; exit 2; }
MARKER_RE="$(python3 -c 'import re,sys;print("(?s).*"+re.escape(sys.argv[1])+".*")' "$MARKER")"
echo "verify $SCREEN on $DEV — expecting live marker: '$MARKER'  (from $EXPO_PUBLIC_API_URL)"
[ "$DRY" = 1 ] && { echo "DRY $SCREEN: marker='$MARKER' regex='$MARKER_RE'"; exit 0; }

# 3. Drive the device: open the screen, wait for the marker to be visible.
if [ -n "$FLOW_OVERRIDE" ]; then case "$FLOW_OVERRIDE" in /*) FLOW="$FLOW_OVERRIDE";; *) FLOW="$HERE/$FLOW_OVERRIDE";; esac; fi
[ -f "$FLOW" ] || { echo "FAIL: flow not found: $FLOW"; exit 2; }
set +e
( cd "$HERE" && "$MAESTRO" --device "$DEV" test \
    -e ROUTE="universal://$SCREEN" -e MARKER="$MARKER_RE" -e SCREEN="$SCREEN" ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"} \
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
# "not found" alone is NOT a harness error: Maestro's ordinary assertion failure says "Element not found".
if ! grep -qE "COMPLETED|FAILED" "$OUT/$SCREEN.maestro.log" || grep -qiE "Java 17|No devices|Unable to connect|device .* not found|Failed to connect|maestro: command not found|unbound variable|syntax error|Parsing Failed" "$OUT/$SCREEN.maestro.log"; then
  echo "HARNESS ERROR $SCREEN (not a verification result): maestro could not run — see $OUT/$SCREEN.maestro.log"
  grep -iE "Java 17|No devices|Unable to connect|device .* not found|Failed to connect|maestro: command not found|unbound variable|syntax error|Parsing Failed" "$OUT/$SCREEN.maestro.log" | head -3
  exit 2
fi
echo "FAILED $SCREEN (maestro rc=$RC): '$MARKER' NOT seen on $DEV — see $OUT/$SCREEN.maestro.log and $OUT/$SCREEN.png"
tail -15 "$OUT/$SCREEN.maestro.log"
exit 1

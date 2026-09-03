#!/usr/bin/env bash
# sync-health.sh — T5 of the plan: OBSERVE the sync pipeline's health, never assume it.
#
# "Silence is the enemy." Exit 0 = healthy, 1 = unhealthy, 2 = could not determine.
# Read-only: it only lists GitHub Actions runs. It never touches the pipeline.
#
# Thresholds derive from the OBSERVED cadence, not the declared cron (docs: GitHub drops
# scheduled runs under load; sync.yml declares */30min but delivers ~2.5–5 h, 24/24 success
# on 2026-09-03). Override with SYNC_MAX_AGE_H / BRIDGE_MAX_AGE_H if the cadence changes.
set -uo pipefail
GH=${GH:-/opt/homebrew/bin/gh}
REPO=drkostas/soma
SYNC_MAX_AGE_H="${SYNC_MAX_AGE_H:-6}"      # sync.yml: observed ~3 h between successes
BRIDGE_MAX_AGE_H="${BRIDGE_MAX_AGE_H:-18}" # strava-bridge-ts.yml runs 11/15/19 UTC → the overnight gap is 16 h; 12 h false-alarmed every morning

check() { # name workflow max_age_h
  local name="$1" wf="$2" max="$3" json
  json="$($GH run list --repo "$REPO" --workflow "$wf" --limit 8 --json status,conclusion,createdAt 2>/dev/null)" \
    || { echo "UNKNOWN $name: gh run list failed (auth? network?)"; return 2; }
  # JSON goes in as an ARGUMENT. Two stdin redirects once made python execute the JSON
  # (a valid literal) as its script and exit 0 with no output — a green check over a hole.
  python3 - "$name" "$max" "$json" <<'PY'
import json,sys,datetime as dt
name,max_h=sys.argv[1],float(sys.argv[2]); rows=json.loads(sys.argv[3])
now=dt.datetime.now(dt.timezone.utc)
ok=[r for r in rows if r["status"]=="completed" and r["conclusion"]=="success"]
bad=[r for r in rows if r["status"]=="completed" and r["conclusion"] not in ("success",None)]
if not rows: print(f"UNKNOWN {name}: no runs returned"); sys.exit(2)
if not ok: print(f"UNHEALTHY {name}: no successful run in the last {len(rows)}"); sys.exit(1)
t=dt.datetime.fromisoformat(ok[0]["createdAt"].replace("Z","+00:00")); age_h=(now-t).total_seconds()/3600
latest=rows[0]
if age_h>max_h:
    print(f"UNHEALTHY {name}: last success {age_h:.1f} h ago (> {max_h:g} h); latest run {latest['status']}/{latest['conclusion']}"); sys.exit(1)
extra=f"; {len(bad)} non-success in last {len(rows)}" if bad else ""
print(f"OK {name}: last success {age_h:.1f} h ago (limit {max_h:g} h){extra}"); sys.exit(0)
PY
}

rc=0
check "sync-pipeline"  "sync.yml"             "$SYNC_MAX_AGE_H";   r=$?; [ $r -gt $rc ] && rc=$r
check "strava-bridge"  "strava-bridge-ts.yml" "$BRIDGE_MAX_AGE_H"; r=$?; [ $r -gt $rc ] && rc=$r
exit $rc

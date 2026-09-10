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
SYNC_LOCAL_LOG="${SYNC_LOCAL_LOG:-$HOME/Library/Logs/soma/sync-local.log}"

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

check_local_sync() { # name max_age_h
  # The pipeline's own record of what it did, judged by the status it recorded and NOT by the
  # exit code: it has written thousands of records and exited 0 while garmin-ingest had been
  # dead for 38 hours, and only the recorded status showed `partial`. Counting `success` alone
  # means a `partial` that never recovers ages into a failure on its own.
  local name="$1" max="$2"
  [ -r "$SYNC_LOCAL_LOG" ] || { echo "UNKNOWN $name: local run log $SYNC_LOCAL_LOG is missing or unreadable"; return 2; }
  python3 - "$name" "$max" "$SYNC_LOCAL_LOG" <<'PY'
import re,sys,datetime as dt
name,max_h,path=sys.argv[1],float(sys.argv[2]),sys.argv[3]
START=re.compile(r'^=== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \S+ sync starting ===')
REC=re.compile(r'^\[sync\] run recorded: (\w+)')
runs, started = [], None      # runs: [(started_at, status)] in file order
for line in open(path, errors="replace"):
    m = START.match(line)
    if m:
        started = dt.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").astimezone()
        continue
    m = REC.match(line)
    if m and started is not None:
        runs.append((started, m.group(1))); started = None
if not runs:
    print(f"UNKNOWN {name}: no completed run found in {path}"); sys.exit(2)
recent = runs[-8:]
ok = [r for r in recent if r[1] == "success"]
bad = [r for r in recent if r[1] != "success"]
if not ok:
    print(f"UNHEALTHY {name}: no successful run in the last {len(recent)} (local)"); sys.exit(1)
age_h = (dt.datetime.now().astimezone() - ok[-1][0]).total_seconds() / 3600
if age_h > max_h:
    print(f"UNHEALTHY {name}: last success {age_h:.1f} h ago (> {max_h:g} h); last run recorded {recent[-1][1]} (local)"); sys.exit(1)
extra = f"; {len(bad)} non-success in last {len(recent)}" if bad else ""
print(f"OK {name}: last success {age_h:.1f} h ago (limit {max_h:g} h){extra} (local)"); sys.exit(0)
PY
}

# Where the pipeline runs decides where its health can be read. sync.yml keeps its schedule so
# forks still work, but skips the job on this instance when PIPELINE_RUNS_LOCALLY is set, because
# two schedulers against one database would duplicate every step. Checking Actions here anyway
# reported "last success 23.5 h ago" and grew by an hour every hour, with no state the pipeline
# could reach that would clear it. Mirror the workflow's own condition rather than restate it.
PIPELINE_RUNS_LOCALLY="$($GH variable get PIPELINE_RUNS_LOCALLY --repo "$REPO" 2>/dev/null || true)"

rc=0
if [ "$PIPELINE_RUNS_LOCALLY" = "true" ]; then
  check_local_sync "sync-pipeline" "$SYNC_MAX_AGE_H"; r=$?; [ $r -gt $rc ] && rc=$r
else
  check "sync-pipeline" "sync.yml" "$SYNC_MAX_AGE_H"; r=$?; [ $r -gt $rc ] && rc=$r
fi
check "strava-bridge"  "strava-bridge-ts.yml" "$BRIDGE_MAX_AGE_H"; r=$?; [ $r -gt $rc ] && rc=$r
exit $rc

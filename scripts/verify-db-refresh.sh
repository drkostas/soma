#!/usr/bin/env bash
# verify-db-refresh.sh: snapshot the live local database into verify_soma.
#
# The verification server (port 3457, launchd dev.gkos.soma.web) reads verify_soma so that
# Maestro and Playwright runs never write into the real data. This refreshes that copy.
#
#   scripts/verify-db-refresh.sh            # soma -> verify_soma
#   SOMA_DB=soma_other scripts/verify-db-refresh.sh
#
# What it does, in order: dump the source, terminate whatever is connected to verify_soma
# (the 3457 server's pool reconnects on its next query), drop and recreate verify_soma,
# restore, ANALYZE (statistics do not come back with the data), then compare table and row
# counts against the source so the run proves what it did. The only database it ever drops
# is verify_soma; the source is read once and never written.
set -euo pipefail
SRC=${SOMA_DB:-soma}
DST=verify_soma
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-5432}
[ "$SRC" != "$DST" ] || { echo "refusing: source and target are both $DST" >&2; exit 2; }
psql -Atc "select 1" "$SRC" >/dev/null || { echo "refusing: cannot read source $SRC" >&2; exit 2; }

count_tables() { psql -Atc "select count(*) from information_schema.tables where table_schema='public'" "$1" 2>/dev/null || echo 0; }
count_rows()   { psql -Atc "select count(*) from garmin_raw_data" "$1" 2>/dev/null || echo 0; }
newest()       { psql -Atc "select coalesce(max(date)::text,'none') from garmin_raw_data" "$1" 2>/dev/null || echo none; }

echo "before  $DST: $(count_tables "$DST") tables, $(count_rows "$DST") garmin rows, newest $(newest "$DST")"
echo "source  $SRC: $(count_tables "$SRC") tables, $(count_rows "$SRC") garmin rows, newest $(newest "$SRC")"

DUMP=$(mktemp -t verify_soma).dump
trap 'rm -f "$DUMP"' EXIT
pg_dump -Fc -f "$DUMP" "$SRC"
echo "dumped  $SRC -> $DUMP ($(du -h "$DUMP" | cut -f1))"

psql -qc "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DST' and pid<>pg_backend_pid()" postgres >/dev/null
dropdb --if-exists "$DST"
createdb "$DST"
# pg_restore exits non-zero on harmless ownership notices; the comparison below is the gate.
pg_restore -d "$DST" --no-owner --no-acl "$DUMP" || true
psql -qc "ANALYZE" "$DST"

ST=$(count_tables "$SRC"); DT=$(count_tables "$DST"); SR=$(count_rows "$SRC"); DR=$(count_rows "$DST")
echo "after   $DST: $DT tables, $DR garmin rows, newest $(newest "$DST")"
if [ "$ST" != "$DT" ] || [ "$SR" != "$DR" ]; then
  echo "MISMATCH: source $ST tables/$SR rows, copy $DT tables/$DR rows" >&2; exit 1
fi
echo "ok      $DST matches $SRC"
"$(dirname "$0")/report-to-drlab.sh" verify_db_age_hours 0

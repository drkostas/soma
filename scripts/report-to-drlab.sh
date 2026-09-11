#!/usr/bin/env bash
# report-to-drlab.sh: one fact about soma into the estate record (soma T7, soma#903).
#
#   scripts/report-to-drlab.sh sync_green true
#   scripts/report-to-drlab.sh deployed_commit 262b84e
#   scripts/report-to-drlab.sh verify_db_age_hours 0
#
# Never a notification: drlab decides what is notable. Silent when drlab is not reachable or the
# token is missing (a report is never worth failing the caller), one stderr line when the record
# refuses the name, which means it was not declared (drlab kernel/soma_facts.sql).
set -u
NAME=${1:?fact name}; VALUE=${2:?fact value}
TOK=$(python3 -c "import json;print(json.load(open('$HOME/.config/drlab/secrets.json'))['drlab://api-token'])" 2>/dev/null) || exit 0
case "$VALUE" in true|false) JSON="$VALUE" ;; ''|*[!0-9.]*) JSON="\"$VALUE\"" ;; *) JSON="$VALUE" ;; esac
OUT=$(curl -s -m 5 -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project\":\"soma\",\"facts\":{\"$NAME\":$JSON}}" http://localhost:8787/observe 2>/dev/null) || exit 0
printf '%s' "$OUT" | /usr/bin/grep -q '"ok": true' || echo "report-to-drlab: $NAME not recorded: ${OUT:0:160}" >&2
exit 0

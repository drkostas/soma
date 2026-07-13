"""Re-send the Telegram activity notification for one or more Garmin activities.

One-off corrective tool: the original notification may have gone out with the
wrong label ("Run") or before jump data existed. This re-fetches the (now
correct) share image and re-sends it with the activity-type-aware caption. Runs
on the cloud via the resend-telegram workflow — no local dependency.

Run:  cd sync && python -m src.resend_telegram 23573197188 23572684262 ...
"""
import argparse
import sys

import psycopg2

from config import DATABASE_URL
from telegram_notify import is_configured, send_activity_image


def _summary(conn, activity_id: int):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT raw_json->'activityType'->>'typeKey', "
            "raw_json->>'activityName', raw_json->>'startTimeLocal' "
            "FROM garmin_activity_raw WHERE activity_id = %s AND endpoint_name = 'summary'",
            (activity_id,),
        )
        return cur.fetchone()


def resend(activity_ids: list[int]) -> int:
    if not is_configured():
        print("Telegram not configured — skipping.")
        return 0
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    sent = 0
    for aid in activity_ids:
        row = _summary(conn, aid)
        if not row:
            print(f"  {aid}: no summary row, skipping")
            continue
        type_key, name, start_local = row
        activity_date = (start_local or "")[:10]
        ok = send_activity_image(
            garmin_activity_id=aid,
            title=name or "Activity",
            activity_date=activity_date,
            activity_type=type_key,
        )
        print(f"  {aid}: {'re-sent' if ok else 'FAILED'} ({type_key})")
        sent += 1 if ok else 0
    print(f"Done: {sent}/{len(activity_ids)} notifications re-sent.")
    return sent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+", type=int, help="Garmin activity ids to re-send")
    args = ap.parse_args()
    resend(args.ids)


if __name__ == "__main__":
    main()

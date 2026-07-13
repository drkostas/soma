"""Re-finalize already-bridged Strava activities: re-set the title, description and
image via the Strava web session (the same mechanism the bridge uses — no paid API).

For kite sessions that were bridged before their jumps were extracted, so they got a
0-jump image and a description with no jump data. Looks up the Strava id via
strava_bridge_uploads, rebuilds the kite title/description from the (now present)
jump data, regenerates the image, and re-sets all three on the Strava edit page.

Run: cd sync && python -m src.refinalize_strava 23573197188 23572684262 ...
Runs on the cloud via the refinalize-strava workflow — no local dependency.
"""
import argparse
import json
import logging
import os

import psycopg2

import strava_web
from config import DATABASE_URL
from garmin_client import init_garmin
from strava_bridge_push import _image_for, _kite_finalize_fields

logger = logging.getLogger(__name__)


def _strava_id(conn, gid: int) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT strava_activity_id FROM strava_bridge_uploads WHERE garmin_activity_id = %s",
            (gid,),
        )
        row = cur.fetchone()
    return int(row[0]) if row and row[0] else None


def _summary(conn, gid: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT raw_json FROM garmin_activity_raw "
            "WHERE activity_id = %s AND endpoint_name = 'summary'",
            (gid,),
        )
        row = cur.fetchone()
    if not row or row[0] is None:
        return {}
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+", type=int, help="Garmin activity ids to re-finalize")
    args = ap.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    g = init_garmin()

    email, password = strava_web._creds()
    if not (email and password):
        print("RESULT: Strava web not configured (no STRAVA_WEB_EMAIL/PASSWORD)")
        return

    from playwright.sync_api import sync_playwright

    channel = os.environ.get("STRAVA_WEB_CHANNEL") or None
    done, failed = 0, 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, channel=channel)  # headed (xvfb in CI)
        ctx = browser.new_context(viewport={"width": 1366, "height": 1000})
        page = ctx.new_page()

        authed = False
        stored = strava_web._load_session(conn)
        if stored:
            try:
                ctx.add_cookies(stored)
                authed = strava_web._session_valid(page)
            except Exception:  # noqa: BLE001
                authed = False
        if not authed:
            try:
                strava_web._login(page, email, password)
                try:
                    strava_web._save_session(conn, ctx.cookies())
                except Exception:  # noqa: BLE001
                    pass
            except Exception as exc:  # noqa: BLE001
                print(f"RESULT: Strava login failed: {str(exc)[:60]}")
                browser.close()
                return

        for gid in args.ids:
            sid = _strava_id(conn, gid)
            if not sid:
                print(f"  {gid}: not in strava_bridge_uploads, skipping")
                continue
            summary = _summary(conn, gid)
            title, desc = _kite_finalize_fields(conn, g, gid, summary)
            if title is None:
                title = summary.get("activityName") or "Activity"
                desc = summary.get("description") or ""
            img = _image_for(gid, conn)
            try:
                strava_web.set_activity_details(
                    page, sid, title=title, description=desc,
                    image_path=img, replace_photo=True,
                )
                print(f"  {gid} -> strava/{sid}: re-finalized ({title})")
                done += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  {gid} -> strava/{sid}: FAILED {str(exc)[:80]}")
                failed += 1
        browser.close()

    print(f"RESULT: re-finalized {done}, failed {failed}")


if __name__ == "__main__":
    main()

"""Push recent Garmin activities that aren't on Strava yet, autonomously.

soma can't use Strava's paid upload API, so a finalized Garmin activity reaches
Strava through the facterino bridge account (uploading a FIT to it makes Garmin
forward the activity to Strava for free). The forward carries only the workout
data, so the title, description and image are set afterwards on the Strava web
edit page. Both legs run in CI: Garmin `connectapi` works from GitHub Actions,
and the Strava edit page is driven headed under xvfb (headless is reCAPTCHA-
blocked), reusing the stored `strava_web_session`.

Dedup: `strava_bridge_uploads(garmin_activity_id PK -> strava_activity_id)`. The
row is written the moment the forward is seen, before the finalize, so a failed
finalize never causes a re-upload (and re-uploading an identical FIT is Garmin-
dedup-safe anyway). Per-activity failures are isolated. Prints one `RESULT:`
line for the workflow log / chat summary.
"""
from __future__ import annotations

import datetime
import io
import json
import logging
import os
import re
import time
import urllib.request
import zipfile

import psycopg2
from garminconnect import Garmin

import strava_bridge
import strava_web
from garmin_client import init_garmin

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
SOMA = os.environ.get("SOMA_WEB_URL") or os.environ.get("SOMA_BASE_URL") or "https://soma.gkos.dev"
LOOKBACK_DAYS = 3
FORWARD_POLL_S = 15
FORWARD_TRIES = 48  # ~12 minutes for Garmin to forward to Strava


def _missed(g, conn) -> list[dict]:
    """Recent Garmin activities not yet on Strava (not bridged, not already synced)."""
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=LOOKBACK_DAYS)).isoformat()
    acts = g.get_activities_by_date(start, today.isoformat())
    with conn.cursor() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS strava_bridge_uploads ("
            "garmin_activity_id BIGINT PRIMARY KEY, strava_activity_id BIGINT, "
            "uploaded_at TIMESTAMPTZ DEFAULT NOW())"
        )
        cur.execute("SELECT garmin_activity_id FROM strava_bridge_uploads")
        done = {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT raw_json->>'external_id' FROM strava_raw_data "
            "WHERE jsonb_typeof(raw_json)='object' AND raw_json->>'external_id' IS NOT NULL"
        )
        ext = " ".join(r[0] for r in cur.fetchall() if r[0])
    conn.commit()
    return [a for a in acts if a["activityId"] not in done and str(a["activityId"]) not in ext]


def _image_for(gid: int, conn) -> str | None:
    """Download the share image: the hevy card for strength, else the activity card."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT hevy_id FROM workout_enrichment WHERE garmin_activity_id=%s "
            "ORDER BY processed_at DESC LIMIT 1",
            (gid,),
        )
        row = cur.fetchone()
    conn.commit()
    url = f"{SOMA}/api/workout/{row[0]}/image" if row else f"{SOMA}/api/activity/{gid}/image"
    path = f"/tmp/bridge_{gid}.png"
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as r:
            with open(path, "wb") as fp:
                fp.write(r.read())
        return path
    except Exception as exc:  # noqa: BLE001
        logger.warning("image fetch failed for %s: %s", gid, exc)
        return None


def _fit_for(g, gid: int) -> str:
    """Download the activity's original FIT (the file that gets forwarded)."""
    data = g.download_activity(gid, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
    z = zipfile.ZipFile(io.BytesIO(data))
    name = next(n for n in z.namelist() if n.lower().endswith(".fit"))
    path = f"/tmp/bridge_{gid}.fit"
    with open(path, "wb") as fp:
        fp.write(z.read(name))
    return path


def _record(conn, gid: int, sid: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO strava_bridge_uploads VALUES (%s,%s,NOW()) "
            "ON CONFLICT (garmin_activity_id) DO UPDATE SET "
            "strava_activity_id=EXCLUDED.strava_activity_id, uploaded_at=NOW()",
            (gid, int(sid)),
        )
    conn.commit()


def _load_kite_payload(conn, gid: int) -> dict | None:
    """Stored kite_jumps payload for a Garmin activity, or None."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT raw_json FROM garmin_activity_raw "
            "WHERE activity_id = %s AND endpoint_name = 'kite_jumps'",
            (gid,),
        )
        row = cur.fetchone()
    conn.commit()
    if not row or row[0] is None:
        return None
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def _kite_finalize_fields(conn, g, gid: int, summary: dict) -> tuple[str | None, str | None]:
    """Title + description for a kite activity, built from its per-jump data
    (extracting the jumps on demand if they are missing, so the Strava image and
    description are never stuck at 0 jumps). Returns (None, None) for non-kite
    activities so the caller keeps the default Garmin name/description."""
    type_key = ((summary.get("activityType") or {}).get("typeKey") or "").lower()
    if "kite" not in type_key:
        return None, None
    payload = _load_kite_payload(conn, gid)
    if payload is None:
        from backfill_kite_jumps import store_kite_jumps_for_activity
        try:
            payload = store_kite_jumps_for_activity(conn, g, gid, summary.get("startTimeGMT"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("kite jump extraction failed for %s during finalize: %s", gid, exc)
            return None, None
    from garmin_push import kite_activity_name, generate_kite_strava_description
    return kite_activity_name(summary, payload), generate_kite_strava_description(summary, payload)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    conn = psycopg2.connect(DATABASE_URL)
    g = init_garmin()

    missed = _missed(g, conn)
    if not missed:
        print("RESULT: nothing to push (all recent activities on Strava)")
        return
    logger.info("bridge: %d to push: %s", len(missed), [a["activityId"] for a in missed])

    email, password = strava_web._creds()
    if not (email and password):
        print("RESULT: ISSUES: Strava web not configured (no STRAVA_WEB_EMAIL/PASSWORD)")
        return

    from playwright.sync_api import sync_playwright

    channel = os.environ.get("STRAVA_WEB_CHANNEL") or None
    pushed: list[str] = []
    issues: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, channel=channel)  # headed (xvfb in CI)
        ctx = browser.new_context(viewport={"width": 1366, "height": 1000})
        page = ctx.new_page()

        # Reuse the stored session; log in only if it's missing or expired.
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
                authed = True
                try:
                    strava_web._save_session(conn, ctx.cookies())
                    conn.commit()
                except Exception:  # noqa: BLE001
                    pass
            except Exception as exc:  # noqa: BLE001
                print(f"RESULT: ISSUES: Strava login failed: {str(exc)[:60]}")
                browser.close()
                return

        def own() -> set[str]:
            """The user's OWN Strava activity ids (training log, not the social feed)."""
            for _ in range(4):
                try:
                    page.goto("https://www.strava.com/athlete/training",
                              wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(3500)
                    ids = set(re.findall(r"/activities/(\d+)", page.content()))
                    if ids:
                        return ids
                except Exception:  # noqa: BLE001
                    pass
                page.wait_for_timeout(4000)
            raise RuntimeError("athlete/training would not load")

        for a in missed:
            gid = a["activityId"]
            name = a.get("activityName") or "Workout"
            try:
                # Kite sessions get a jump-aware title + description (and jumps are
                # extracted here if missing, so the image below shows real jumps).
                kite_title, kite_desc = _kite_finalize_fields(conn, g, gid, a)
                if kite_title:
                    name = kite_title
                desc = kite_desc if kite_desc is not None else ((g.get_activity(gid) or {}).get("description") or "")
                img = _image_for(gid, conn)
                fit = _fit_for(g, gid)
                before = own()
                strava_bridge.upload_finalized_activity(fit)  # facterino forwards to Strava
                newid = None
                for _ in range(FORWARD_TRIES):
                    time.sleep(FORWARD_POLL_S)
                    try:
                        diff = own() - before
                    except Exception:  # noqa: BLE001
                        continue
                    if diff:
                        newid = sorted(diff, key=int)[-1]
                        break
                if not newid:
                    issues.append(f"{name}: forward not seen in {FORWARD_TRIES * FORWARD_POLL_S // 60}min")
                    continue
                _record(conn, gid, newid)  # record BEFORE finalize -> never a duplicate
                strava_web.set_activity_details(
                    page, int(newid), title=name, description=desc,
                    image_path=img, replace_photo=True,
                )
                pushed.append(f"{name}->strava/{newid}")
                logger.info("pushed %s (%s) -> strava/%s", name, gid, newid)
            except Exception as exc:  # noqa: BLE001
                issues.append(f"{name}: {str(exc)[:60]}")
                logger.warning("bridge push failed for %s: %s", gid, exc)
        browser.close()

    parts = []
    if pushed:
        parts.append("PUSHED: " + " ;; ".join(pushed))
    if issues:
        parts.append("ISSUES: " + " ;; ".join(issues))
    print("RESULT: " + (" | ".join(parts) if parts else "nothing to push"))


if __name__ == "__main__":
    main()

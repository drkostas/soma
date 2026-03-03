# sync/src/dj_daemon.py
"""Live DJ daemon — polls Garmin HR + Spotify, queues songs dynamically.

Usage:
    python dj_daemon.py \
        --hr-rest 60 --hr-max 190 --offset 0 \
        --genres rock,pop --sources liked \
        --status-file /tmp/soma-dj-status.json \
        --pid-file /tmp/soma-dj-pid

The daemon writes status JSON every poll cycle and exits cleanly on SIGTERM.
"""
import argparse
import json
import os
import signal
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import requests

# Add src to path when run directly
sys.path.insert(0, str(Path(__file__).parent))

from bpm_formula import hrr_to_bpm, latest_hr_from_garmin_data
from config import DATABASE_URL
from garmin_client import init_garmin
from shuffle import SessionState, interleaved_shuffle

POLL_INTERVAL = 30  # seconds between main loop iterations
QUEUE_AHEAD_MS = 45_000  # queue next song when this many ms remain
HR_SHIFT_THRESHOLD = 8  # BPM change that triggers a queue replacement


def _get_spotify_token() -> str:
    """Read and refresh Spotify access token from DB."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT credentials FROM platform_credentials WHERE platform = 'spotify'",
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError("Spotify not connected — link Spotify in the web app first")
            creds = row[0]
            if isinstance(creds, str):
                creds = json.loads(creds)

        # Check expiry
        expires_at_str = creds.get("expires_at")
        if expires_at_str:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if (expires_at - now).total_seconds() < 60:
                return _refresh_spotify_token(conn, creds)

        return creds["access_token"]
    finally:
        conn.close()


def _refresh_spotify_token(conn, creds: dict) -> str:
    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "c1f3c6c2a3f141eb82f9cc5ba148187a")
    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": creds["refresh_token"],
            "client_id": client_id,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    new_token = data["access_token"]
    new_expires = (datetime.now(timezone.utc) + timedelta(seconds=data["expires_in"])).isoformat()
    update_payload: dict = {"access_token": new_token, "expires_at": new_expires}
    if "refresh_token" in data:
        update_payload["refresh_token"] = data["refresh_token"]
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE platform_credentials
               SET credentials = credentials || %s::jsonb
               WHERE platform = 'spotify'""",
            (json.dumps(update_payload),),
        )
        conn.commit()
    return new_token


def _spotify_get(path: str, token: str) -> dict:
    resp = requests.get(
        f"https://api.spotify.com/v1{path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code == 204:
        return {}
    resp.raise_for_status()
    return resp.json()


def _spotify_post(path: str, token: str, params: dict | None = None) -> None:
    resp = requests.post(
        f"https://api.spotify.com/v1{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or {},
        timeout=10,
    )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"Spotify POST {path} failed: {resp.status_code} {resp.text}")


def _query_tracks(target_bpm: int, genres: list[str], sources: list[str], exclude_ids: list[str]) -> list[dict]:
    """Query DB for tracks matching BPM ± 5.

    Note: ``sources`` is currently unused because ``spotify_track_features``
    has no per-source column (all cached tracks are undifferentiated).
    The parameter is kept for API compatibility and future enhancement when
    source-based filtering (e.g. liked, playlist) is added to the table.
    """
    lo, hi = target_bpm - 5, target_bpm + 5
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            if genres:
                cur.execute(
                    """SELECT track_id, name, artist_name, artist_name as artist_id, tempo, energy
                       FROM spotify_track_features
                       WHERE tempo BETWEEN %s AND %s
                       AND genres && %s
                       AND track_id NOT IN (SELECT track_id FROM user_blacklist)
                       AND (%s IS NULL OR track_id != ALL(%s::text[]))
                       LIMIT 200""",
                    (lo, hi, genres, exclude_ids or None, exclude_ids or None),
                )
            else:
                cur.execute(
                    """SELECT track_id, name, artist_name, artist_name as artist_id, tempo, energy
                       FROM spotify_track_features
                       WHERE tempo BETWEEN %s AND %s
                       AND track_id NOT IN (SELECT track_id FROM user_blacklist)
                       AND (%s IS NULL OR track_id != ALL(%s::text[]))
                       LIMIT 200""",
                    (lo, hi, exclude_ids or None, exclude_ids or None),
                )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()


def _write_status(status_file: str, status: dict) -> None:
    tmp = status_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(status, f)
    os.replace(tmp, status_file)


def run_daemon(
    hr_rest: int,
    hr_max: int,
    offset: int,
    genres: list[str],
    sources: list[str],
    status_file: str,
    pid_file: str,
) -> None:
    """Main daemon loop."""
    # Write PID
    Path(pid_file).write_text(str(os.getpid()))

    # Graceful shutdown on SIGTERM
    _stop_event = threading.Event()
    def _handle_sigterm(*_):
        _stop_event.set()
    signal.signal(signal.SIGTERM, _handle_sigterm)

    garmin = init_garmin()
    session = SessionState()
    last_hr: int | None = None
    last_target_bpm: int | None = None
    queued_track_id: str | None = None
    queued_track_name: str | None = None

    _write_status(status_file, {"state": "starting", "hr": None, "target_bpm": None})

    while not _stop_event.is_set():
        try:
            token = _get_spotify_token()

            # 1. Poll Garmin HR
            today = date.today().isoformat()
            hr_data = garmin.get_heart_rates(today)
            current_hr = latest_hr_from_garmin_data(hr_data, window_seconds=120)
            if current_hr is not None:
                last_hr = current_hr

            target_bpm: int | None = None
            if last_hr is not None:
                target_bpm = hrr_to_bpm(last_hr, hr_rest=hr_rest, hr_max=hr_max, offset=offset)

            # 2. Poll currently-playing
            now_playing = _spotify_get("/me/player/currently-playing", token)
            current_track_id = None
            current_track_name = None
            ms_remaining = None

            if now_playing and now_playing.get("is_playing") and now_playing.get("item"):
                item = now_playing["item"]
                current_track_id = item["id"]
                current_track_name = item["name"]
                duration_ms = item["duration_ms"]
                progress_ms = now_playing.get("progress_ms", 0)
                ms_remaining = duration_ms - progress_ms

                # Track played → add to session
                if current_track_id and current_track_id != queued_track_id:
                    session.mark_played(current_track_id)
                    session.last_played_artist_id = (
                        item.get("artists", [{}])[0].get("id") or
                        item.get("artists", [{}])[0].get("name", "").lower().replace(" ", "_")
                    )

                # When queued track starts playing, clear the queued state
                if current_track_id == queued_track_id:
                    queued_track_id = None
                    queued_track_name = None

            # 3. Decide whether to queue
            should_queue = False
            replace_reason = None

            if target_bpm is not None and ms_remaining is not None:
                if ms_remaining < QUEUE_AHEAD_MS:
                    should_queue = True
                    replace_reason = "45s_remaining"
                elif last_target_bpm is not None and abs(target_bpm - last_target_bpm) >= HR_SHIFT_THRESHOLD:
                    should_queue = True
                    replace_reason = f"hr_shift_{last_target_bpm}_to_{target_bpm}"

            if should_queue and target_bpm is not None:
                exclude_ids = list(session.played | session.skipped)
                if current_track_id:
                    exclude_ids.append(current_track_id)

                candidates = _query_tracks(target_bpm, genres, sources, exclude_ids)
                filtered = session.filter_candidates(candidates)
                shuffled = interleaved_shuffle(filtered, state=session)

                if shuffled:
                    next_song = shuffled[0]
                    next_track_id = next_song["track_id"]
                    _spotify_post(
                        "/me/player/queue",
                        token,
                        params={"uri": f"spotify:track:{next_track_id}"},
                    )
                    queued_track_id = next_track_id
                    queued_track_name = next_song["name"]
                else:
                    queued_track_id = None
                    queued_track_name = None

            # Update last_target_bpm after every successful HR read
            if target_bpm is not None:
                last_target_bpm = target_bpm

            # 4. Write status
            _write_status(status_file, {
                "state": "running",
                "hr": last_hr,
                "target_bpm": target_bpm,
                "offset": offset,
                "current_track": current_track_name,
                "current_track_id": current_track_id,
                "ms_remaining": ms_remaining,
                "queued_track": queued_track_name,
                "queued_track_id": queued_track_id,
                "replace_reason": replace_reason,
                "session_played_count": len(session.played),
                "ts": time.time(),
            })

        except Exception as exc:
            _write_status(status_file, {
                "state": "error",
                "error": str(exc),
                "ts": time.time(),
            })

        _stop_event.wait(timeout=POLL_INTERVAL)

    # Cleanup
    _write_status(status_file, {"state": "stopped"})
    try:
        Path(pid_file).unlink(missing_ok=True)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="Soma Live DJ daemon")
    parser.add_argument("--hr-rest", type=int, default=60)
    parser.add_argument("--hr-max", type=int, default=190)
    parser.add_argument("--offset", type=int, default=0, help="+12 pump up, 0 normal, -12 wind down")
    parser.add_argument("--genres", default="", help="Comma-separated genre list")
    parser.add_argument("--sources", default="liked", help="Comma-separated source list")
    parser.add_argument("--status-file", default="/tmp/soma-dj-status.json")
    parser.add_argument("--pid-file", default="/tmp/soma-dj-pid")
    args = parser.parse_args()

    genres = [g.strip() for g in args.genres.split(",") if g.strip()]
    sources = [s.strip() for s in args.sources.split(",") if s.strip()]

    run_daemon(
        hr_rest=args.hr_rest,
        hr_max=args.hr_max,
        offset=args.offset,
        genres=genres,
        sources=sources,
        status_file=args.status_file,
        pid_file=args.pid_file,
    )


if __name__ == "__main__":
    main()

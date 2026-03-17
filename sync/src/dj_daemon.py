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
from config import DATABASE_URL, today_nyc
from garmin_client import init_garmin
from shuffle import SessionState, interleaved_shuffle

POLL_INTERVAL = 30  # seconds between main loop iterations
QUEUE_AHEAD_MS = 45_000  # queue next song when this many ms remain
HR_SHIFT_THRESHOLD = 8  # BPM change that triggers a queue replacement
HR_WINDOW_SECONDS = 86400  # use HR readings up to 24 hours old (Garmin syncs infrequently)


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


def _album_image_url(item: dict) -> str | None:
    """Return a medium-sized album art URL from a Spotify track item."""
    images = (item.get("album") or {}).get("images") or []
    if not images:
        return None
    # Prefer ~300px (index 1 of 3), fall back to whatever's available
    return images[min(1, len(images) - 1)]["url"]


def _fetch_track_details(track_id: str, token: str) -> dict:
    """Fetch duration_ms and image_url for a track from Spotify."""
    try:
        data = _spotify_get(f"/tracks/{track_id}", token)
        return {
            "duration_ms": data.get("duration_ms"),
            "image_url": _album_image_url(data),
        }
    except Exception:
        return {"duration_ms": None, "image_url": None}


def _spotify_post(path: str, token: str, params: dict | None = None) -> None:
    resp = requests.post(
        f"https://api.spotify.com/v1{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or {},
        timeout=10,
    )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"Spotify POST {path} failed: {resp.status_code} {resp.text}")


def _spotify_put(path: str, token: str, json_body: dict | None = None) -> None:
    resp = requests.put(
        f"https://api.spotify.com/v1{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=json_body or {},
        timeout=10,
    )
    if resp.status_code not in (200, 202, 204):
        raise RuntimeError(f"Spotify PUT {path} failed: {resp.status_code} {resp.text}")


def _fetch_source_track_ids(sources: list[str], token: str) -> set[str] | None:
    """Return allowed track IDs for the given sources.

    Returns None if 'liked' is in sources (= entire cached library, no filter needed).
    Returns a set of track IDs when specific playlist IDs are given.
    """
    if not sources or "liked" in sources:
        return None  # liked songs == entire DB cache — no filtering needed

    ids: set[str] = set()
    for source in sources:
        offset = 0
        while True:
            try:
                data = _spotify_get(
                    f"/playlists/{source}/items?limit=50&offset={offset}",
                    token,
                )
            except Exception as exc:
                print(f"[dj] Cannot read playlist {source}: {exc}", flush=True)
                break
            items = data.get("items") or []
            for item in items:
                # /playlists/{id}/items returns track under "item" key (new API)
                # while the legacy /tracks endpoint used "track" — handle both
                track = item.get("item") or item.get("track") or {}
                if track.get("id"):
                    ids.add(track["id"])
            if len(items) < 50 or not data.get("next"):
                break
            offset += 50
    return ids or None


def _fetch_album_track_ids(album_id: str, token: str) -> set[str]:
    """Return all track IDs for a Spotify album."""
    ids: set[str] = set()
    offset = 0
    while True:
        data = _spotify_get(f"/albums/{album_id}/tracks?limit=50&offset={offset}", token)
        items = data.get("items") or []
        for item in items:
            if item.get("id"):
                ids.add(item["id"])
        if len(items) < 50 or not data.get("next"):
            break
        offset += 50
    return ids


def _query_tracks(
    target_bpm: int,
    genres: list[str],
    sources: list[str],
    exclude_ids: list[str],
    allowed_ids: set[str] | None = None,
    bpm_window: int = 5,
) -> list[dict]:
    """Query DB for candidate tracks.

    Library mode (allowed_ids=None): BPM ±bpm_window against full cache.
    Playlist mode (allowed_ids set): no BPM window — returns all playlist
    tracks ordered by BPM proximity so the best match is always returned even
    when no tracks sit exactly at the target BPM.

    Half/double BPM: also searches at target_bpm/2 and target_bpm*2 so tracks
    at musically compatible tempos are included.
    """
    # BPM targets: exact, half, double (clamped to 60-200)
    bpm_targets = {target_bpm}
    for mult in (0.5, 2.0):
        alt = round(target_bpm * mult)
        if 60 <= alt <= 200:
            bpm_targets.add(alt)

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            where: list[str] = []
            params: list = []

            if allowed_ids is not None:
                # Playlist mode: filter to playlist tracks, sort by BPM proximity
                where.append("track_id = ANY(%s::text[])")
                params.append(list(allowed_ids))
            else:
                # Library mode: BPM window across all target tempos
                bpm_conditions = " OR ".join(
                    "tempo BETWEEN %s AND %s" for _ in bpm_targets
                )
                where.append(f"({bpm_conditions})")
                for t in sorted(bpm_targets):
                    params.extend([t - bpm_window, t + bpm_window])

            if genres:
                where.append("genres && %s")
                params.append(genres)

            where.append("track_id NOT IN (SELECT track_id FROM user_blacklist)")

            if exclude_ids:
                where.append("track_id != ALL(%s::text[])")
                params.append(exclude_ids)

            order = ""
            if allowed_ids is not None:
                order = "ORDER BY ABS(tempo - %s)"
                params.append(target_bpm)

            sql = f"""SELECT track_id, name, artist_name, artist_name as artist_id, tempo, energy
                      FROM spotify_track_features
                      WHERE {' AND '.join(where)}
                      {order}
                      LIMIT 200"""
            cur.execute(sql, params)
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
    # Persist played track IDs across restarts so the same songs aren't
    # immediately re-queued. Keep last 200 played IDs in a temp file.
    PLAYED_HISTORY_FILE = "/tmp/soma-dj-played.json"
    try:
        prev_played = json.loads(Path(PLAYED_HISTORY_FILE).read_text())
        if isinstance(prev_played, list):
            for tid in prev_played[-200:]:
                session.played.add(tid)
    except Exception:
        pass

    last_hr: int | None = None
    last_hr_ts: float | None = None  # wall-clock time of last successful HR read
    last_target_bpm: int | None = None
    queued_track_id: str | None = None
    queued_track_name: str | None = None
    first_queue_done = False  # queue immediately on first iteration
    last_current_track_id: str | None = None  # detect track changes
    allowed_ids: set[str] | None = None  # track IDs allowed by source filter
    observation_fallback: bool = False  # True when allowed_ids comes from observation (not direct fetch)
    source_ids_loaded = False
    source_refresh_counter = 0
    SOURCE_REFRESH_INTERVAL = 20  # re-fetch source IDs every 20 polls (~10 min)
    last_context_uri: str | None = None  # for auto-detect mode
    observed_context_tracks: set[str] = set()  # tracks seen playing in current context (fallback when playlist fetch fails)
    queue_history: list[dict] = []  # rolling log of queued tracks (newest last)
    play_history: list[dict] = []  # ordered play log: [{track_id,name,artist,track_bpm,target_bpm,started_at,duration_ms,image_url,status}]
    hr_history: list[dict] = []  # rolling HR readings: [{ts, hr, target_bpm}]
    HR_HISTORY_MAX_SECONDS = 7200  # keep last 2 hours

    _write_status(status_file, {"state": "starting", "hr": None, "target_bpm": None})

    while not _stop_event.is_set():
        try:
            token = _get_spotify_token()

            # 0. Refresh source track IDs periodically (only when sources are explicitly set)
            auto_detect = not sources or sources == ["auto"]
            if not auto_detect:
                if not source_ids_loaded or source_refresh_counter == 0:
                    try:
                        allowed_ids = _fetch_source_track_ids(sources, token)
                        source_ids_loaded = True
                    except Exception:
                        pass  # keep previous allowed_ids on failure
                source_refresh_counter = (source_refresh_counter + 1) % SOURCE_REFRESH_INTERVAL

            # 1. Poll Garmin HR
            today = today_nyc().isoformat()
            hr_data = garmin.get_heart_rates(today)
            current_hr_result = latest_hr_from_garmin_data(hr_data, window_seconds=HR_WINDOW_SECONDS)
            if current_hr_result is not None:
                last_hr, last_hr_ts = current_hr_result  # last_hr_ts = actual reading time, not fetch time

            target_bpm: int | None = None
            if last_hr is not None:
                target_bpm = hrr_to_bpm(last_hr, hr_rest=hr_rest, hr_max=hr_max, offset=offset)

            # 2. Poll currently-playing
            now_playing = _spotify_get("/me/player/currently-playing", token)
            current_track_id = None
            current_track_name = None
            ms_remaining = None
            item: dict = {}
            progress_ms: int = 0
            duration_ms: int = 0
            prev_queued_track_id = queued_track_id  # save before it may be cleared below

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

                # When queued track starts playing, mark it played and clear queued state
                if current_track_id == queued_track_id:
                    session.mark_played(current_track_id)
                    session.last_played_artist_id = (
                        item.get("artists", [{}])[0].get("id") or
                        item.get("artists", [{}])[0].get("name", "").lower().replace(" ", "_")
                    )
                    queued_track_id = None
                    queued_track_name = None

            # Detect track change (for immediate re-queue trigger)
            track_just_changed = (
                current_track_id is not None and
                current_track_id != last_current_track_id and
                last_current_track_id is not None  # don't trigger on very first poll
            )
            last_current_track_id = current_track_id

            # 2c. Update play_history with real song start times
            if current_track_id and item:
                actual_started_at = time.time() - progress_ms / 1000
                artist_name = (item.get("artists") or [{}])[0].get("name") or ""

                if not play_history:
                    # First poll — initialize with current song
                    play_history.append({
                        "track_id": current_track_id,
                        "name": current_track_name or "",
                        "artist": artist_name,
                        "track_bpm": None,
                        "target_bpm": target_bpm,
                        "started_at": actual_started_at,
                        "duration_ms": duration_ms or None,
                        "image_url": _album_image_url(item),
                        "status": "current",
                    })
                elif track_just_changed:
                    # Mark old current entry as played
                    for e in play_history:
                        if e["status"] == "current":
                            e["status"] = "played"
                            break
                    if current_track_id == prev_queued_track_id:
                        # Queued song just started — promote its entry to current
                        promoted = False
                        for e in play_history:
                            if e["status"] == "queued" and e.get("track_id") == current_track_id:
                                e["status"] = "current"
                                e["started_at"] = actual_started_at
                                e["image_url"] = _album_image_url(item) or e.get("image_url")
                                e["duration_ms"] = duration_ms or e.get("duration_ms")
                                promoted = True
                                break
                        if not promoted:
                            play_history.append({
                                "track_id": current_track_id,
                                "name": current_track_name or "",
                                "artist": artist_name,
                                "track_bpm": None,
                                "target_bpm": target_bpm,
                                "started_at": actual_started_at,
                                "duration_ms": duration_ms or None,
                                "image_url": _album_image_url(item),
                                "status": "current",
                            })
                    else:
                        # User changed song manually — discard queued entry, add new current
                        play_history[:] = [e for e in play_history if e["status"] != "queued"]
                        play_history.append({
                            "track_id": current_track_id,
                            "name": current_track_name or "",
                            "artist": artist_name,
                            "track_bpm": None,
                            "target_bpm": target_bpm,
                            "started_at": actual_started_at,
                            "duration_ms": duration_ms or None,
                            "image_url": _album_image_url(item),
                            "status": "current",
                        })
                else:
                    # Normal poll — keep current entry fresh
                    for e in play_history:
                        if e["status"] == "current" and e.get("track_id") == current_track_id:
                            e["started_at"] = actual_started_at  # re-calc from fresh progress_ms
                            e["duration_ms"] = duration_ms or e.get("duration_ms")
                            break
                play_history[:] = play_history[-20:]  # keep last 20 entries

            # 2b. Auto-detect source context from currently-playing
            current_context_name: str | None = None
            if auto_detect and now_playing:
                ctx = now_playing.get("context") or {}
                ctx_uri: str = ctx.get("uri") or ""
                ctx_type: str = ctx.get("type") or ""

                # Context changed — reset and re-fetch
                if ctx_uri != last_context_uri:
                    last_context_uri = ctx_uri
                    source_ids_loaded = False
                    observed_context_tracks.clear()
                    allowed_ids = None
                    observation_fallback = False

                if ctx_uri and not source_ids_loaded:
                    ctx_id = ctx_uri.split(":")[-1]
                    fetch_ok = False
                    try:
                        if ctx_type == "playlist":
                            fetched = _fetch_source_track_ids([ctx_id], token)
                            if fetched:  # None means 'liked'/full-library; empty means fetch failed
                                allowed_ids = fetched
                                observation_fallback = False
                                fetch_ok = True
                        elif ctx_type == "album":
                            allowed_ids = _fetch_album_track_ids(ctx_id, token) or None
                            observation_fallback = False
                            fetch_ok = bool(allowed_ids)
                        else:
                            allowed_ids = None  # artist / search — no filter
                            observation_fallback = False
                            fetch_ok = True
                    except Exception as exc:
                        print(f"[dj] Auto-detect source fetch failed: {exc}", flush=True)

                    if not fetch_ok and ctx_type == "playlist":
                        # Playlist not accessible (not owned) — seed from recently-played
                        try:
                            recent = _spotify_get("/me/player/recently-played?limit=50", token)
                            for item in (recent.get("items") or []):
                                if (item.get("context") or {}).get("uri") == ctx_uri:
                                    tid = (item.get("track") or {}).get("id")
                                    if tid:
                                        observed_context_tracks.add(tid)
                        except Exception:
                            pass
                        observation_fallback = True
                        print(f"[dj] Playlist {ctx_id} inaccessible — using observation fallback ({len(observed_context_tracks)} seeds)", flush=True)

                    source_ids_loaded = True

                # Add currently-playing track to observed set (observation fallback)
                if auto_detect and ctx_uri and current_track_id and observation_fallback:
                    observed_context_tracks.add(current_track_id)

                # Use observed tracks as filter when direct fetch failed
                if observation_fallback and observed_context_tracks:
                    allowed_ids = set(observed_context_tracks)

                # Context display name
                if ctx_type == "playlist":
                    try:
                        playlist_meta = _spotify_get(
                            f"/playlists/{ctx_uri.split(':')[-1]}?fields=name", token
                        )
                        current_context_name = playlist_meta.get("name") or f"playlist:{ctx_uri.split(':')[-1]}"
                    except Exception:
                        current_context_name = f"playlist:{ctx_uri.split(':')[-1]}"
                elif ctx_type == "album":
                    try:
                        album_meta = _spotify_get(f"/albums/{ctx_uri.split(':')[-1]}", token)
                        current_context_name = album_meta.get("name")
                    except Exception:
                        current_context_name = "album"
                elif not ctx_uri:
                    allowed_ids = None  # no context (playing from search, etc.)

            # Append HR snapshot for chart history
            if last_hr is not None:
                hr_history.append({
                    "ts": time.time(),
                    "hr": last_hr,
                    "target_bpm": target_bpm,
                })
                # Trim to rolling 2-hour window
                cutoff = time.time() - HR_HISTORY_MAX_SECONDS
                hr_history[:] = [p for p in hr_history if p["ts"] >= cutoff]

            # 3. Decide whether to queue
            should_queue = False
            replace_reason = None
            no_queue_reason: str | None = None
            is_playing = bool(
                now_playing and now_playing.get("is_playing") and now_playing.get("item")
            )

            if target_bpm is None:
                no_queue_reason = "no_hr"
            elif not first_queue_done:
                # Always queue/play immediately on first iteration
                should_queue = True
                replace_reason = "initial"
            elif queued_track_id is not None:
                no_queue_reason = "already_queued"
            elif track_just_changed:
                # New song started — queue the next one immediately
                should_queue = True
                replace_reason = "track_started"
            elif ms_remaining is not None:
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

                # Try ±5 BPM window first, then expand to ±15 if no results
                candidates = _query_tracks(target_bpm, genres, sources, exclude_ids, allowed_ids=allowed_ids, bpm_window=5)
                if not candidates:
                    candidates = _query_tracks(target_bpm, genres, sources, exclude_ids, allowed_ids=allowed_ids, bpm_window=15)
                # If observation fallback has no BPM-indexed tracks yet, fall back to full library
                if not candidates and observation_fallback:
                    candidates = _query_tracks(target_bpm, genres, sources, exclude_ids, allowed_ids=None, bpm_window=15)
                filtered = session.filter_candidates(candidates)
                shuffled = interleaved_shuffle(filtered, state=session)

                if shuffled:
                    next_song = shuffled[0]
                    next_track_id = next_song["track_id"]
                    if not first_queue_done and not is_playing:
                        # Nothing playing yet — start immediately instead of queuing
                        _spotify_put(
                            "/me/player/play",
                            token,
                            json_body={"uris": [f"spotify:track:{next_track_id}"]},
                        )
                    else:
                        _spotify_post(
                            "/me/player/queue",
                            token,
                            params={"uri": f"spotify:track:{next_track_id}"},
                        )
                    queued_track_id = next_track_id
                    queued_track_name = next_song["name"]
                    queue_history.append({
                        "name": next_song["name"],
                        "artist": next_song.get("artist_name", ""),
                        "target_bpm": target_bpm,
                        "track_bpm": round(next_song.get("tempo", 0)),
                        "reason": replace_reason or "queued",
                        "ts": time.time(),
                    })
                    queue_history[:] = queue_history[-10:]  # keep last 10
                    first_queue_done = True  # successful — stop forcing on every iteration
                    no_queue_reason = None
                    # Add queued entry to play_history with estimated start time
                    current_ph = next((e for e in play_history if e["status"] == "current"), None)
                    if current_ph and current_ph.get("duration_ms"):
                        est_start = current_ph["started_at"] + current_ph["duration_ms"] / 1000
                    else:
                        est_start = time.time() + (ms_remaining / 1000 if ms_remaining else 300)
                    track_info = _fetch_track_details(next_track_id, token)
                    play_history[:] = [e for e in play_history if e["status"] != "queued"]
                    play_history.append({
                        "track_id": next_track_id,
                        "name": next_song["name"],
                        "artist": next_song.get("artist_name") or "",
                        "track_bpm": round(next_song.get("tempo") or 0) or None,
                        "target_bpm": target_bpm,
                        "started_at": est_start,
                        "duration_ms": track_info["duration_ms"],
                        "image_url": track_info["image_url"],
                        "status": "queued",
                    })
                    play_history[:] = play_history[-20:]
                    # Mark queued song as played immediately so it's excluded from
                    # future selections and persisted even if session ends before next queue
                    session.mark_played(next_track_id)
                    # Persist played history so next session avoids repeats
                    try:
                        all_played = list(session.played)[-200:]
                        Path(PLAYED_HISTORY_FILE).write_text(json.dumps(all_played))
                    except Exception:
                        pass
                else:
                    queued_track_id = None
                    queued_track_name = None
                    no_queue_reason = "no_candidates"
                    # Leave first_queue_done = False so we retry next poll

            # Update last_target_bpm after every successful HR read
            if target_bpm is not None:
                last_target_bpm = target_bpm

            # 4. Write status
            hr_age_s = round(time.time() - last_hr_ts) if last_hr_ts else None
            _write_status(status_file, {
                "state": "running",
                "hr": last_hr,
                "hr_age_s": hr_age_s,
                "target_bpm": target_bpm,
                "offset": offset,
                "current_track": current_track_name,
                "current_track_id": current_track_id,
                "ms_remaining": ms_remaining,
                "queued_track": queued_track_name,
                "queued_track_id": queued_track_id,
                "replace_reason": replace_reason,
                "no_queue_reason": no_queue_reason,
                "session_played_count": len(session.played),
                "allowed_track_count": len(allowed_ids) if allowed_ids is not None else None,
                "auto_detect": auto_detect,
                "context_name": current_context_name if auto_detect else None,
                "queue_history": queue_history,
                "play_history": play_history,
                "hr_history": hr_history,
                "ts": time.time(),
            })

        except Exception as exc:
            _write_status(status_file, {
                "state": "error",
                "error": str(exc),
                "hr_history": hr_history,
                "queue_history": queue_history,
                "play_history": play_history,
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

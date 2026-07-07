"""Session-based Strava web connector (no public API).

Strava's public API cannot attach photos to an activity (and the API app is
subscription-locked), so this connector drives Strava's web UI with Playwright to
log in and upload the generated kite share image. Modeled on the vessel_fort AXS
pattern: let the browser do the login, then act as the logged-in user.

Validated 2026-07-06: headless login is blocked by Strava's reCAPTCHA ("unexpected
error"); a HEADED browser logs in cleanly. In CI (Linux) run headed under xvfb.
The activity edit page exposes a file input; Playwright set_input_files lands the
photo in the Media section and Save persists it.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

LOGIN_URL = "https://www.strava.com/login"


def _creds() -> tuple[str | None, str | None]:
    return os.environ.get("STRAVA_WEB_EMAIL"), os.environ.get("STRAVA_WEB_PASSWORD")


def is_configured() -> bool:
    email, password = _creds()
    return bool(email and password)


_SESSION_COOKIES = ("_strava4_session", "_currentH", "_strava_cpra", "_strava_cpra_uid")


def _ensure_session_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS strava_web_session ("
            "id INT PRIMARY KEY DEFAULT 1, cookies JSONB NOT NULL, "
            "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
        )


def _load_session(conn) -> list[dict] | None:
    """Load stored Playwright cookies for reuse (avoids logging in every run,
    which Strava rate-limits). Returns None if no session stored."""
    if conn is None:
        return None
    _ensure_session_table(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT cookies FROM strava_web_session WHERE id = 1")
        row = cur.fetchone()
    if not (row and row[0]):
        return None
    # Playwright add_cookies rejects a non-numeric `expires`; drop it (the values
    # act as session cookies for the run, which is all we need).
    return [{k: v for k, v in c.items() if k != "expires"} for c in row[0]]


def _save_session(conn, cookies: list[dict]) -> None:
    import json
    keep = [
        {k: c.get(k) for k in ("name", "value", "domain", "path", "httpOnly", "secure", "sameSite")}
        for c in cookies if any(n in (c.get("name") or "") for n in _SESSION_COOKIES) or "strava" in (c.get("domain") or "")
    ]
    if conn is None or not keep:
        return
    _ensure_session_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO strava_web_session (id, cookies, updated_at) VALUES (1, %s, NOW()) "
            "ON CONFLICT (id) DO UPDATE SET cookies = EXCLUDED.cookies, updated_at = NOW()",
            (json.dumps(keep),),
        )


def _session_valid(page) -> bool:
    """A stored session is only trustworthy if a real authed page loads."""
    page.goto("https://www.strava.com/dashboard", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2000)
    return "/login" not in page.url


def _login(page, email: str, password: str) -> None:
    """The proven 3-step flow: email → 'Use password instead' → password → dashboard.
    Raises if the session does not leave /login (bad creds or a bot challenge)."""
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2000)
    for label in ("Accept All", "Reject Non-Essential"):
        btn = page.get_by_role("button", name=label)
        if btn.count():
            btn.first.click()
            break
    page.wait_for_timeout(700)
    page.locator('input[type="email"]:visible').first.fill(email)
    page.locator('button[type="submit"]:visible').first.click()
    page.wait_for_timeout(3500)
    # Strava now promotes one-time codes; click through to the password field.
    use_pw = page.get_by_role("button", name="Use password instead")
    if use_pw.count():
        try:
            use_pw.first.click(force=True)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(2000)
    page.locator('input[type="password"]:visible').first.fill(password)
    page.locator('button[type="submit"]:visible').first.click()
    page.wait_for_timeout(7000)
    if "/login" in page.url:
        raise RuntimeError("Strava login failed (still on /login — bad creds or bot challenge)")


_PHOTO_CDN = "dgtzuqphqg23d.cloudfront.net"  # Strava serves activity photos from here


def _delete_existing_photos(page) -> int:
    """Remove all existing photos on the open edit page: click a photo → its
    'Delete' button → repeat. Caller saves. Returns how many were removed."""
    deleted = 0
    for _ in range(12):
        photos = page.locator(f'img[src*="{_PHOTO_CDN}"]')
        if photos.count() == 0:
            break
        photos.first.scroll_into_view_if_needed()
        photos.first.click()
        page.wait_for_timeout(900)
        btn = page.get_by_role("button", name="Delete")
        if not btn.count():
            break
        btn.first.click()
        page.wait_for_timeout(900)
        deleted += 1
    return deleted


def _upload_one(page, activity_id: int, image_path: str, replace: bool = False) -> None:
    """Attach `image_path` to the activity via the edit page's Media file input.
    replace=True first deletes any existing photos, so a regenerated image swaps
    the old one instead of stacking a duplicate."""
    page.goto(
        f"https://www.strava.com/activities/{activity_id}/edit",
        wait_until="domcontentloaded", timeout=45000,
    )
    page.wait_for_timeout(3500)
    if replace:
        _delete_existing_photos(page)
        page.wait_for_timeout(500)
    before = page.locator("img").count()
    page.locator("input[type=file]").first.set_input_files(image_path)
    # wait for the new media thumbnail to appear (presigned upload completes)
    for _ in range(25):
        page.wait_for_timeout(1000)
        if page.locator("img").count() > before:
            break
    else:
        raise RuntimeError(f"photo did not attach for activity {activity_id}")
    page.get_by_role("button", name="Save").first.click()
    page.wait_for_timeout(5000)


def upload_photos(items: list[tuple[int, str]], conn=None, channel: str | None = None, replace: bool = False) -> list[tuple[int, bool]]:
    """Upload photos to Strava activities in one logged-in session.

    items: list of (strava_activity_id, image_path).
    conn:  optional DB connection for session reuse (stores the login cookies so we
           don't log in every run — Strava rate-limits repeated logins).
    channel: browser channel ("chrome" locally; None uses Playwright's Chromium,
             which is what CI uses under xvfb).
    Returns [(activity_id, ok)]. Never raises — per-activity failures are isolated
    (axs skip-on-failure). Always headed; headless is blocked by Strava's reCAPTCHA.
    """
    from playwright.sync_api import sync_playwright

    email, password = _creds()
    if not (email and password):
        logger.warning("Strava web connector not configured (no STRAVA_WEB_EMAIL/PASSWORD)")
        return [(a, False) for a, _ in items]
    if not items:
        return []

    channel = channel or os.environ.get("STRAVA_WEB_CHANNEL") or None
    results: list[tuple[int, bool]] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, channel=channel)  # headed (xvfb in CI)
        ctx = browser.new_context(viewport={"width": 1366, "height": 1000})
        page = ctx.new_page()
        # Reuse a stored session; only log in when it's missing or expired.
        stored = _load_session(conn)
        authed = False
        if stored:
            try:
                ctx.add_cookies(stored)
                authed = _session_valid(page)
            except Exception:  # noqa: BLE001
                authed = False
        if not authed:
            try:
                _login(page, email, password)
                authed = True
                try:
                    _save_session(conn, ctx.cookies())
                except Exception:  # noqa: BLE001
                    pass
            except Exception as exc:  # noqa: BLE001
                logger.error("Strava web login failed: %s", exc)
                browser.close()
                return [(a, False) for a, _ in items]
        for activity_id, image_path in items:
            try:
                _upload_one(page, activity_id, image_path, replace=replace)
                logger.info("Attached photo to Strava activity %s", activity_id)
                results.append((activity_id, True))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Photo upload failed for %s: %s", activity_id, exc)
                results.append((activity_id, False))
        browser.close()
    return results

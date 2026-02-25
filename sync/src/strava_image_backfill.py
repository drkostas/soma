"""One-time Strava workout image backfill via Playwright browser automation.

For each Hevy-synced Strava activity:
  1. Remove Hevy auto-uploaded workout summary photo
  2. Upload SOMA workout card image
  3. Ensure it's the highlight (first photo position)

Usage:
    pip install playwright && playwright install chromium

    # Step 1 — Login (opens browser, you log in manually, session saved):
    python -m src.strava_image_backfill --login

    # Step 2 — Build manifest (catalogs activities + photos via API, generates images):
    python -m src.strava_image_backfill --manifest

    # Step 3 — Explore one activity to verify selectors work:
    python -m src.strava_image_backfill --explore STRAVA_ID

    # Step 4 — Execute full backfill:
    python -m src.strava_image_backfill --run

    # Resume from index 50 / process single activity:
    python -m src.strava_image_backfill --run --start 50
    python -m src.strava_image_backfill --run --only STRAVA_ID
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure src/ is on the path for sibling module imports (db, config, etc.)
_src_dir = str(Path(__file__).parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "strava_backfill_data"
SESSION_FILE = DATA_DIR / "session.json"
MANIFEST_FILE = DATA_DIR / "manifest.json"
PROGRESS_FILE = DATA_DIR / "progress.json"
IMAGES_DIR = DATA_DIR / "images"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"

STRAVA_WEB = "https://www.strava.com"
NEXT_JS_BASE = "http://localhost:3456"

# Delay between activities (seconds) — stay well under any rate limit
DEFAULT_DELAY = 5

# ---------------------------------------------------------------------------
# Strava API helpers (uses existing OAuth client for read operations)
# ---------------------------------------------------------------------------

def _get_strava_client():
    """Authenticated Strava API client with auto-refreshed tokens."""
    from db import get_connection, get_platform_credentials, upsert_platform_credentials
    from strava_client import StravaClient

    with get_connection() as conn:
        creds = get_platform_credentials(conn, "strava")
    if not creds or creds["status"] != "active":
        raise RuntimeError("Strava not connected — set up credentials first.")

    tokens = creds["credentials"]
    client = StravaClient(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
    )
    new = client.refresh_tokens()
    exp = new.get("expires_at")
    with get_connection() as conn:
        upsert_platform_credentials(
            conn, "strava", "oauth2",
            {**tokens, "access_token": new["access_token"],
             "refresh_token": new["refresh_token"]},
            expires_at=datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None,
        )
    return client


def _get_hevy_strava_mappings() -> list[dict]:
    """All Hevy→Strava activity mappings, ordered chronologically."""
    from db import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT asl.source_id, asl.destination_id,
                       h.raw_json->>'title',
                       h.raw_json->>'start_time'
                FROM activity_sync_log asl
                JOIN hevy_raw_data h
                  ON h.hevy_id = asl.source_id AND h.endpoint_name = 'workout'
                WHERE asl.source_platform = 'hevy'
                  AND asl.destination = 'strava'
                  AND asl.status IN ('sent', 'external')
                ORDER BY h.raw_json->>'start_time' ASC
            """)
            return [
                {"hevy_id": r[0], "strava_id": r[1],
                 "title": r[2], "start_time": r[3]}
                for r in cur.fetchall()
            ]


def _get_activity_photos(client, strava_id: str) -> list[dict]:
    """List photos for a Strava activity via public API."""
    try:
        return client._get(
            f"/activities/{strava_id}/photos",
            params={"photo_sources": "true", "size": 600},
        )
    except Exception as e:
        logger.warning(f"  Photos API error for {strava_id}: {e}")
        return []


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def _fetch_workout_image(hevy_id: str, save_path: Path) -> bool:
    """Download SOMA workout card PNG from Next.js API."""
    url = f"{NEXT_JS_BASE}/api/workout/{hevy_id}/image"
    try:
        resp = requests.get(url, timeout=30)
        if resp.status_code == 200 and len(resp.content) > 1000:
            save_path.write_bytes(resp.content)
            return True
        logger.warning(f"  Image {hevy_id}: HTTP {resp.status_code} ({len(resp.content)}b)")
        return False
    except Exception as e:
        logger.warning(f"  Image {hevy_id}: {e}")
        return False



def _is_likely_hevy_photo(photo: dict, total_photos: int) -> bool:
    """Heuristic: is this photo a Hevy auto-uploaded workout card?

    Data analysis of all 265 Hevy-synced activities shows:
      - Every activity has either 0 or 1 photo (no multi-photo cases)
      - Hevy photos are either 768x512 (landscape, older) or 432x768 (portrait, newer)
      - No user-uploaded photos exist on any of these activities

    So: 1 photo on a Hevy-synced activity = Hevy photo, always.
    For multi-photo (shouldn't happen but just in case), check sizes from API.
    """
    if total_photos == 1:
        return True

    # Multi-photo fallback: check if API-reported sizes match Hevy patterns
    sizes = photo.get("sizes", {}).get("600", [])
    if len(sizes) == 2:
        w, h = sizes
        # Known Hevy patterns: 768x512 (landscape) or 432x768 (portrait)
        if (w, h) in [(768, 512), (432, 768)]:
            return True
        # General portrait workout card
        if h > w * 1.3:
            return True

    return False


# ---------------------------------------------------------------------------
# Progress tracking (for resume after crash)
# ---------------------------------------------------------------------------

def _load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"processed": [], "failed": [], "skipped": []}


def _save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


# ---------------------------------------------------------------------------
# Playwright helpers
# ---------------------------------------------------------------------------

def _screenshot(page, name: str):
    """Save a debug screenshot."""
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path = SCREENSHOTS_DIR / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=False)
    except Exception:
        pass


def _dismiss_overlays(page):
    """Dismiss cookie consent banners, modals, popups."""
    dismiss_selectors = [
        # Strava Cookiebot banner (most common)
        "button.CybotCookiebotDialogBodyButton:has-text('OK')",
        # Generic cookie consent
        "button:has-text('Accept')",
        "button:has-text('Got it')",
        # Strava premium upsell
        "button[class*='dismiss']",
        "button[aria-label='Close']",
    ]
    for sel in dismiss_selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=800):
                el.click()
                page.wait_for_timeout(500)
        except Exception:
            pass


def _find_and_click(page, description: str, selectors: list[str],
                    timeout: int = 3000, fallback_pause: bool = True) -> bool:
    """Try selectors in order. If all fail and fallback_pause is True,
    screenshot + pause for manual intervention.
    """
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=timeout):
                el.click()
                page.wait_for_timeout(1000)
                return True
        except Exception:
            continue

    if fallback_pause:
        _screenshot(page, f"cant_find_{description.replace(' ', '_')}")
        print(f"    Could not find: {description}")
        print(f"    Screenshot saved. Please do it manually in the browser, then press Enter...")
        input()
        return True  # assume user did it

    return False


# ---------------------------------------------------------------------------
# Phase: --login
# ---------------------------------------------------------------------------

def do_login(timeout_s: int = 300):
    """Interactive Strava login via Playwright browser — saves session state.

    Opens a browser to Strava's login page. Polls the URL every 2 seconds
    to detect when the user has completed login (URL leaves /login).
    Auto-saves session once logged in, or times out.
    """
    from playwright.sync_api import sync_playwright

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        page.goto(f"{STRAVA_WEB}/login")
        page.wait_for_timeout(2000)

        # Save a screenshot so we can verify the page loaded
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOTS_DIR / "login_page.png"))
        print(f"  Screenshot: {SCREENSHOTS_DIR / 'login_page.png'}", flush=True)

        print(f"\n  Browser opened at Strava login page.")
        print(f"  Please log in — session will auto-save when detected.")
        print(f"  Waiting up to {timeout_s}s...\n", flush=True)

        # Poll until URL changes away from /login (user completed login)
        elapsed = 0
        last_url = ""
        while elapsed < timeout_s:
            page.wait_for_timeout(3000)
            elapsed += 3
            url = page.url
            if url != last_url:
                print(f"  [{elapsed}s] URL: {url}", flush=True)
                last_url = url
            # Logged in if we're on dashboard, feed, athlete, or any non-login page
            if any(path in url for path in ["/dashboard", "/feed", "/athlete", "/activities"]):
                print(f"  Login detected!", flush=True)
                break
            # Also detect: no longer on login/session pages
            if "/login" not in url and "/session" not in url and "strava.com" in url:
                print(f"  Login detected (non-login page)!", flush=True)
                break
        else:
            print("  Timed out waiting for login.", flush=True)
            browser.close()
            return

        # Give the page a moment to settle
        page.wait_for_timeout(2000)

        # Verify by navigating to a protected page
        page.goto(f"{STRAVA_WEB}/athlete/training")
        page.wait_for_timeout(3000)
        if "/login" in page.url:
            print("  Login verification failed — still redirected to login.", flush=True)
            browser.close()
            return

        context.storage_state(path=str(SESSION_FILE))
        print(f"  Session saved to {SESSION_FILE}", flush=True)
        browser.close()


# ---------------------------------------------------------------------------
# Phase: --manifest
# ---------------------------------------------------------------------------

def do_manifest():
    """Catalog all Hevy→Strava activities and generate SOMA card images.

    Skips the Strava photos API (would hit rate limits for 265 activities).
    Earlier analysis confirmed ALL activities have 0 or 1 photo, and any
    existing photo is always a Hevy auto-upload. The run phase detects and
    deletes photos directly in the edit page DOM.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading Hevy→Strava mappings from DB...")
    mappings = _get_hevy_strava_mappings()
    print(f"  {len(mappings)} activities\n")

    # Check Next.js dev server
    nextjs_ok = True
    try:
        requests.get(f"{NEXT_JS_BASE}", timeout=5)
    except Exception:
        nextjs_ok = False
        print(f"  WARNING: Next.js not reachable at {NEXT_JS_BASE}")
        print(f"  Start it:  cd /Users/gkos/projects/soma/web && npm run dev")
        print(f"  Images won't be generated until it's running.\n")

    activities = []
    images_ok = 0
    images_fail = 0

    for i, m in enumerate(mappings):
        hevy_id = m["hevy_id"]
        strava_id = m["strava_id"]
        title = m.get("title") or "?"
        date_str = (m.get("start_time") or "")[:10]

        # Generate/check SOMA card image
        img_path = IMAGES_DIR / f"{hevy_id}.png"
        has_image = img_path.exists()
        if not has_image and nextjs_ok:
            has_image = _fetch_workout_image(hevy_id, img_path)

        if has_image:
            images_ok += 1
        else:
            images_fail += 1

        activities.append({
            "hevy_id": hevy_id,
            "strava_id": strava_id,
            "title": title,
            "date": date_str,
            "image_path": str(img_path) if has_image else None,
        })

        if (i + 1) % 50 == 0 or (i + 1) == len(mappings):
            print(f"  [{i+1}/{len(mappings)}] {title} ({date_str})")

    manifest = {"activities": activities,
                "summary": {"total": len(activities),
                            "images_ok": images_ok,
                            "images_fail": images_fail}}
    MANIFEST_FILE.write_text(json.dumps(manifest, indent=2))

    print(f"\nManifest → {MANIFEST_FILE}")
    print(f"  Total activities:  {len(activities)}")
    print(f"  Images generated:  {images_ok}")
    print(f"  Images failed:     {images_fail}")


# ---------------------------------------------------------------------------
# Phase: --explore  (test selectors on one activity)
# ---------------------------------------------------------------------------

def do_explore(strava_id: str):
    """Open one activity in a real browser, try edit flow, dump DOM info."""
    from playwright.sync_api import sync_playwright

    if not SESSION_FILE.exists():
        print("No session. Run --login first.")
        return

    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            storage_state=str(SESSION_FILE),
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()

        # Log network requests for internal API discovery
        api_calls = []
        def on_request(req):
            if any(kw in req.url for kw in ["photo", "media", "image", "upload"]):
                api_calls.append({"method": req.method, "url": req.url})
        page.on("request", on_request)

        print(f"\n--- Exploring activity {strava_id} ---\n")

        # 1. Load activity page
        page.goto(f"{STRAVA_WEB}/activities/{strava_id}")
        page.wait_for_timeout(3000)
        _dismiss_overlays(page)
        _screenshot(page, f"explore_1_activity_{strava_id}")
        print("  [1] Activity page loaded — screenshot saved")

        # 2. Dump clickable elements that might be the edit button
        buttons = page.locator("button, a, [role='button']").all()
        print(f"\n  Clickable elements ({len(buttons)} total):")
        for btn in buttons[:50]:
            try:
                text = btn.inner_text(timeout=500).strip()[:60]
                aria = btn.get_attribute("aria-label") or ""
                title = btn.get_attribute("title") or ""
                tag = btn.evaluate("el => el.tagName")
                cls = (btn.get_attribute("class") or "")[:60]
                if any(kw in (text + aria + title + cls).lower()
                       for kw in ["edit", "pencil", "kebab", "more", "action",
                                  "option", "menu", "photo", "media"]):
                    print(f"    {tag} text='{text}' aria='{aria}' "
                          f"title='{title}' class='{cls}'")
            except Exception:
                pass

        # 3. Try to open edit
        print("\n  Attempting to open edit form...")
        edit_opened = _find_and_click(page, "edit button", [
            # Direct edit button/link
            'button[title="Edit"]',
            'a[title="Edit"]',
            'a[href*="/edit"]',
            '[data-testid="edit-button"]',
            # Kebab/more menu first, then Edit
        ], timeout=2000, fallback_pause=False)

        if not edit_opened:
            # Try kebab menu → Edit
            print("  Direct edit not found, trying actions menu...")
            _find_and_click(page, "actions menu", [
                'button[title="Actions"]',
                'button[aria-label="More"]',
                'button[title="More"]',
                '[data-testid="overflow-menu"]',
                'button.btn-icon:has(svg)',
            ], timeout=2000, fallback_pause=False)
            page.wait_for_timeout(1000)
            _screenshot(page, f"explore_2_menu_{strava_id}")
            _find_and_click(page, "edit in menu", [
                'a:has-text("Edit")',
                'button:has-text("Edit")',
                '[role="menuitem"]:has-text("Edit")',
            ], timeout=2000, fallback_pause=False)

        page.wait_for_timeout(2000)
        _screenshot(page, f"explore_3_edit_{strava_id}")
        print("  [3] Edit form — screenshot saved")

        # 4. Dump the edit form DOM for media section
        try:
            html = page.content()
            # Save full HTML
            html_path = SCREENSHOTS_DIR / f"explore_edit_{strava_id}.html"
            html_path.write_text(html)
            print(f"  Full HTML saved to {html_path}")
        except Exception:
            pass

        # Look for media/photo section
        media_selectors = [
            "[class*='media']", "[class*='photo']", "[class*='image']",
            "[class*='upload']", "[class*='drop']", "[class*='file']",
            "input[type='file']",
        ]
        print("\n  Media-related elements in edit form:")
        for sel in media_selectors:
            try:
                els = page.locator(sel).all()
                for el in els[:5]:
                    tag = el.evaluate("el => el.tagName")
                    cls = (el.get_attribute("class") or "")[:80]
                    typ = el.get_attribute("type") or ""
                    acc = el.get_attribute("accept") or ""
                    print(f"    {sel} → {tag} class='{cls}' type='{typ}' accept='{acc}'")
            except Exception:
                pass

        # 5. Dump intercepted API calls
        if api_calls:
            print(f"\n  Intercepted API calls ({len(api_calls)}):")
            for c in api_calls:
                print(f"    {c['method']} {c['url']}")

        print("\n  Browser still open — inspect manually, then press Enter.")
        input("  Press Enter to close... ")
        browser.close()


# ---------------------------------------------------------------------------
# Phase: --run  (the actual backfill)
# ---------------------------------------------------------------------------

def _navigate_to_edit(page, strava_id: str) -> bool:
    """Navigate directly to the activity edit page. Returns True on success."""
    page.goto(
        f"{STRAVA_WEB}/activities/{strava_id}/edit",
        wait_until="domcontentloaded",
    )
    page.wait_for_timeout(4000)
    _dismiss_overlays(page)

    # Check the activity actually loaded (not 404 / login redirect)
    if "404" in page.title() or "Page Not Found" in page.title():
        logger.warning(f"  Activity {strava_id} not found (404)")
        return False
    if "/login" in page.url:
        logger.warning(f"  Session expired — redirected to login")
        return False

    # Verify we're on the edit page by checking for the save button
    save_btn = page.locator("button.btn-save-activity")
    if save_btn.count() == 0:
        logger.warning(f"  Edit page didn't load (no save button)")
        _screenshot(page, f"edit_fail_{strava_id}")
        return False

    return True


def _delete_photos_in_edit(page, count_to_delete: int) -> int:
    """Delete Hevy photos from the edit form's media section.

    Strava's MediaUploader React component works as follows:
      - Click the thumbnail button → a popover appears with a "Delete" button
      - Click "Delete" → photo is removed from the form (hidden inputs removed)

    Returns number successfully deleted.
    """
    deleted = 0
    for attempt in range(count_to_delete):
        # Find thumbnail buttons (photo containers in the MediaUploader)
        thumb_btns = page.locator(
            'button[class*="Thumbnail--thumbnail-container"]'
        )
        if thumb_btns.count() == 0:
            logger.info(f"    No more thumbnails to delete")
            break

        try:
            # Click thumbnail to open the popover
            thumb_btns.first.click()
            page.wait_for_timeout(1000)

            # Click the "Delete" button in the popover
            delete_btn = page.locator(
                'button[class*="PopupContents--delete"], '
                'button[class*="PopupContents--popup-button"]:has-text("Delete")'
            )
            if delete_btn.count() > 0 and delete_btn.first.is_visible(timeout=2000):
                delete_btn.first.click()
                page.wait_for_timeout(1500)
                deleted += 1
                logger.info(f"    Deleted photo {attempt + 1}/{count_to_delete}")
                continue

            # Fallback: look for any visible Delete button
            fallback_del = page.locator('button:visible:has-text("Delete")')
            if fallback_del.count() > 0:
                fallback_del.first.click()
                page.wait_for_timeout(1500)
                deleted += 1
                continue

            logger.warning(f"    Delete button not found after clicking thumbnail")
            _screenshot(page, f"delete_fail_{attempt}")
            break

        except Exception as e:
            logger.warning(f"    Delete attempt {attempt} failed: {e}")
            _screenshot(page, f"delete_error_{attempt}")
            break

    return deleted


def _upload_image_in_edit(page, image_path: str) -> bool:
    """Upload a SOMA workout card image via the edit form's file input.

    The MediaUploader has a hidden <input type="file"> inside a dropzone div.
    Playwright's set_input_files() works even on visually-hidden inputs.
    """
    try:
        # The file input is inside the MediaUploader dropzone
        file_input = page.locator(
            '[data-react-class="MediaUploader"] input[type="file"], '
            '[class*="MediaUploader--dropzone"] input[type="file"], '
            'input[type="file"]'
        ).first
        file_input.set_input_files(image_path)
        # Wait for upload to process (React component handles it)
        page.wait_for_timeout(5000)

        # Verify: check if a new thumbnail appeared
        thumbs = page.locator('button[class*="Thumbnail--thumbnail-container"]')
        if thumbs.count() > 0:
            logger.info(f"    Upload successful — {thumbs.count()} thumbnail(s) visible")
            return True
        else:
            logger.warning(f"    Upload may have failed — no thumbnails visible")
            _screenshot(page, "upload_no_thumb")
            return True  # optimistic — save will fail if upload didn't work

    except Exception as e:
        logger.warning(f"    Upload failed: {e}")
        _screenshot(page, "upload_error")
        return False


def _ensure_highlight(page) -> bool:
    """Ensure our uploaded image is the highlight (default photo).

    The highlight is controlled by the hidden input `default_photo_id`.
    After deleting old photos and uploading new ones, this input may still
    reference a deleted photo's UUID. We MUST update it to the new photo's UUID.
    """
    try:
        imgs = page.locator(
            'button[class*="Thumbnail--thumbnail-container"] img[id]'
        )
        if imgs.count() > 0:
            # Our upload should be the last one (or only one)
            last_img = imgs.nth(imgs.count() - 1)
            new_uuid = last_img.get_attribute("id")
            if new_uuid:
                default_input = page.locator('input[name="default_photo_id"]')
                if default_input.count() > 0:
                    old_val = default_input.first.get_attribute("value")
                    default_input.first.evaluate(
                        f'el => el.value = "{new_uuid}"'
                    )
                    logger.info(
                        f"    Set highlight: {old_val[:8] if old_val else '?'}... → {new_uuid[:8]}..."
                    )
                return True
    except Exception as e:
        logger.debug(f"  highlight set failed: {e}")

    return True


def _save_edit(page) -> bool:
    """Click Save on the edit form."""
    try:
        save_btn = page.locator("button.btn-save-activity")
        if save_btn.count() > 0 and save_btn.first.is_visible(timeout=3000):
            save_btn.first.click()
            # Wait for save to complete (page navigates back to activity view)
            page.wait_for_timeout(5000)
            return True

        # Fallback: the hidden submit input
        submit = page.locator('input[type="submit"][value="Save"]')
        if submit.count() > 0:
            submit.first.click()
            page.wait_for_timeout(5000)
            return True

        logger.warning("    Save button not found")
        _screenshot(page, "save_not_found")
        return False
    except Exception as e:
        logger.warning(f"    Save failed: {e}")
        _screenshot(page, "save_error")
        return False


def _process_activity(page, activity: dict) -> str:
    """Process a single activity. Returns 'ok', 'failed', or 'skipped'."""
    strava_id = activity["strava_id"]
    image_path = activity.get("image_path")

    if not image_path or not Path(image_path).exists():
        logger.info(f"    SKIP — no image generated")
        return "skipped"

    # Navigate to edit form
    if not _navigate_to_edit(page, strava_id):
        return "failed"

    # Delete any existing photos (detected from the edit page DOM)
    existing_thumbs = page.locator(
        'button[class*="Thumbnail--thumbnail-container"]'
    )
    thumb_count = existing_thumbs.count()
    if thumb_count > 0:
        deleted = _delete_photos_in_edit(page, thumb_count)
        logger.info(f"    Deleted {deleted}/{thumb_count} existing photo(s)")

    # Upload our image
    uploaded = _upload_image_in_edit(page, image_path)
    if not uploaded:
        _screenshot(page, f"upload_fail_{strava_id}")
        return "failed"
    logger.info(f"    Uploaded SOMA image")

    # Ensure highlight
    _ensure_highlight(page)

    # Save
    if not _save_edit(page):
        _screenshot(page, f"save_fail_{strava_id}")
        return "failed"

    logger.info(f"    Saved")
    return "ok"


def do_run(start: int = 0, only: str | None = None,
           headless: bool = False, delay: int = DEFAULT_DELAY):
    """Execute the backfill on all (or selected) activities."""
    from playwright.sync_api import sync_playwright

    if not MANIFEST_FILE.exists():
        print("No manifest. Run --manifest first.")
        return
    if not SESSION_FILE.exists():
        print("No session. Run --login first.")
        return

    manifest = json.loads(MANIFEST_FILE.read_text())
    activities = manifest["activities"]
    progress = _load_progress()

    if only:
        activities = [a for a in activities if a["strava_id"] == only]
        if not activities:
            print(f"Activity {only} not found in manifest.")
            return

    total = len(activities)
    print(f"\nBackfill: {total} activities, starting from index {start}")
    print(f"  Already processed: {len(progress['processed'])}")
    print(f"  Delay: {delay}s between activities")
    print(f"  Headless: {headless}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            storage_state=str(SESSION_FILE),
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()

        for i, activity in enumerate(activities):
            if i < start:
                continue

            sid = activity["strava_id"]
            title = activity.get("title", "?")
            date = activity.get("date", "?")

            # Skip already processed
            if sid in progress["processed"]:
                continue

            print(f"  [{i+1}/{total}] {title} ({date}) "
                  f"strava={sid} — action={activity.get('action', '?')}")

            try:
                result = _process_activity(page, activity)
            except Exception as e:
                logger.error(f"    EXCEPTION: {e}")
                _screenshot(page, f"exception_{sid}")
                result = "failed"

            if result == "ok":
                progress["processed"].append(sid)
            elif result == "failed":
                progress["failed"].append(sid)
            else:
                progress["skipped"].append(sid)

            _save_progress(progress)

            if result != "skipped":
                time.sleep(delay)

        # Re-save session in case cookies rotated
        try:
            context.storage_state(path=str(SESSION_FILE))
        except Exception:
            pass

        browser.close()

    print(f"\n=== Done ===")
    print(f"  Processed: {len(progress['processed'])}")
    print(f"  Failed:    {len(progress['failed'])}")
    print(f"  Skipped:   {len(progress['skipped'])}")
    if progress["failed"]:
        print(f"\n  Failed IDs: {progress['failed']}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="One-time Strava workout image backfill via Playwright",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--login", action="store_true",
                       help="Interactive Strava login (saves session)")
    group.add_argument("--manifest", action="store_true",
                       help="Catalog activities + generate images")
    group.add_argument("--explore", metavar="STRAVA_ID",
                       help="Explore one activity (test selectors)")
    group.add_argument("--run", action="store_true",
                       help="Execute the backfill")

    parser.add_argument("--start", type=int, default=0,
                        help="Resume --run from this index")
    parser.add_argument("--only", metavar="STRAVA_ID",
                        help="Process only this Strava activity")
    parser.add_argument("--headless", action="store_true",
                        help="Run browser headless (default: visible)")
    parser.add_argument("--delay", type=int, default=DEFAULT_DELAY,
                        help=f"Seconds between activities (default: {DEFAULT_DELAY})")

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if args.login:
        do_login()
    elif args.manifest:
        do_manifest()
    elif args.explore:
        do_explore(args.explore)
    elif args.run:
        do_run(start=args.start, only=args.only,
               headless=args.headless, delay=args.delay)


if __name__ == "__main__":
    main()

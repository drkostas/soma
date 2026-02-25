"""Send workout card images to Telegram after sync."""

import urllib.request
import urllib.error
import json
from io import BytesIO

from config import get_telegram_config

API_BASE = "https://api.telegram.org/bot{token}"


def _get_creds() -> tuple[str, str]:
    """Get current Telegram credentials (reads from DB each time)."""
    return get_telegram_config()


def is_configured() -> bool:
    """Check if Telegram credentials are set."""
    token, chat_id = _get_creds()
    return bool(token and chat_id)


def send_image(image_bytes: bytes, caption: str = "", filename: str = "workout.png") -> bool:
    """Send an image to the configured Telegram chat.

    Uses multipart/form-data via urllib (no external dependencies).
    Returns True on success, False on failure.
    """
    token, chat_id = _get_creds()
    if not token or not chat_id:
        return False

    url = f"{API_BASE.format(token=token)}/sendPhoto"
    boundary = "----SomaSyncBoundary"

    body = BytesIO()

    # chat_id field
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="chat_id"\r\n\r\n'.encode())
    body.write(f"{chat_id}\r\n".encode())

    # caption field
    if caption:
        body.write(f"--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="caption"\r\n\r\n'.encode())
        body.write(f"{caption}\r\n".encode())

    # photo file
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="photo"; filename="{filename}"\r\n'.encode())
    body.write(b"Content-Type: image/png\r\n\r\n")
    body.write(image_bytes)
    body.write(b"\r\n")

    body.write(f"--{boundary}--\r\n".encode())

    data = body.getvalue()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result.get("ok", False)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"    Telegram send failed (HTTP {e.code}): {error_body[:200]}")
        return False
    except Exception as e:
        print(f"    Telegram send failed: {e}")
        return False


def send_workout_image(hevy_id: str, title: str, workout_date: str) -> bool:
    """Fetch a workout card image from the local Next.js server and send it via Telegram."""
    if not is_configured():
        return False

    url = f"http://localhost:3456/api/workout/{hevy_id}/image"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                print(f"    Telegram: image fetch failed (HTTP {resp.status})")
                return False
            image_bytes = resp.read()
    except Exception as e:
        print(f"    Telegram: image fetch failed ({e})")
        return False

    caption = f"{title} — {workout_date}"
    return send_image(image_bytes, caption=caption, filename=f"{hevy_id}.png")


def notify_new_workouts(workouts: list[dict]) -> int:
    """Send Telegram notifications for a list of new workouts.

    Each workout dict should have: hevy_id, hevy_title, workout_date.
    Returns count of successfully sent notifications.
    """
    if not is_configured():
        return 0

    sent = 0
    for w in workouts:
        ok = send_workout_image(
            hevy_id=w["hevy_id"],
            title=w["hevy_title"],
            workout_date=str(w.get("workout_date", "")),
        )
        if ok:
            sent += 1
    return sent

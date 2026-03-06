"""Send workout card images to Telegram after sync."""

import os
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


def _build_multipart(chat_id: str, field: str, filename: str, image_bytes: bytes, caption: str) -> tuple[bytes, str]:
    """Build a multipart/form-data body for Telegram sendPhoto."""
    boundary = "----SomaSyncBoundary"
    body = BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="chat_id"\r\n\r\n'.encode())
    body.write(f"{chat_id}\r\n".encode())
    if caption:
        body.write(f"--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="caption"\r\n\r\n'.encode())
        body.write(f"{caption}\r\n".encode())
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode())
    body.write(b"Content-Type: image/png\r\n\r\n")
    body.write(image_bytes)
    body.write(b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    return body.getvalue(), boundary


def send_image(image_bytes: bytes, caption: str = "", filename: str = "workout.png") -> bool:
    """Send an image to the configured Telegram chat.

    Validates PNG magic bytes, strips RGBA alpha channel (flattening onto dark
    background), and sends via sendPhoto. Returns True on success, False on failure.
    """
    token, chat_id = _get_creds()
    if not token or not chat_id:
        return False

    # Validate PNG magic bytes
    if not image_bytes or image_bytes[:4] != b'\x89PNG':
        print(f"    Telegram: skipping — not a valid PNG ({len(image_bytes)} bytes)")
        return False

    # Strip alpha channel (RGBA → RGB) to prevent Telegram IMAGE_PROCESS_FAILED
    try:
        from PIL import Image
        img = Image.open(BytesIO(image_bytes))
        if img.mode == 'RGBA':
            bg = Image.new('RGB', img.size, (9, 9, 11))  # app dark background
            bg.paste(img, mask=img.split()[3])
            buf = BytesIO()
            bg.save(buf, format='PNG')
            image_bytes = buf.getvalue()
        elif img.mode != 'RGB':
            img = img.convert('RGB')
            buf = BytesIO()
            img.save(buf, format='PNG')
            image_bytes = buf.getvalue()
    except Exception as e:
        print(f"    Telegram: alpha strip failed ({e}), sending as-is")

    url = f"{API_BASE.format(token=token)}/sendPhoto"
    data, boundary = _build_multipart(chat_id, "photo", filename, image_bytes, caption)
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            if result.get("ok", False):
                return True
            print(f"    Telegram sendPhoto returned ok=false: {result}")
            return False
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

    url = f"{os.environ.get('SOMA_WEB_URL', 'http://localhost:3456')}/api/workout/{hevy_id}/image"
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


def send_run_image(garmin_activity_id: str | int, title: str, run_date: str) -> bool:
    """Fetch a run summary image from the local Next.js server and send it via Telegram."""
    if not is_configured():
        return False

    url = f"{os.environ.get('SOMA_WEB_URL', 'http://localhost:3456')}/api/activity/{garmin_activity_id}/image"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                print(f"    Telegram: run image fetch failed (HTTP {resp.status})")
                return False
            image_bytes = resp.read()
    except Exception as e:
        print(f"    Telegram: run image fetch failed ({e})")
        return False

    caption = f"🏃 {title} — {run_date}"
    return send_image(image_bytes, caption=caption, filename=f"run_{garmin_activity_id}.png")



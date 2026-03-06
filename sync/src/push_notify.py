"""Send Web Push notifications to subscribed browsers."""

import os
import json
import logging

from pywebpush import webpush, WebPushException
from db import get_connection

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """Check if VAPID keys are set."""
    return bool(
        os.environ.get("VAPID_PUBLIC_KEY")
        and os.environ.get("VAPID_PRIVATE_KEY")
        and os.environ.get("VAPID_SUBJECT")
    )


def _get_subscriptions() -> list[dict]:
    """Fetch all push subscriptions from the database."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, endpoint, p256dh, auth FROM push_subscriptions")
            rows = cur.fetchall()
    return [
        {"id": r[0], "endpoint": r[1], "p256dh": r[2], "auth": r[3]}
        for r in rows
    ]


def _get_preferences() -> dict:
    """Fetch notification preferences."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT enabled, on_sync_workout, on_sync_run, on_sync_error,
                       on_milestone, on_playlist_ready
                FROM notification_preferences WHERE id = 1
            """)
            row = cur.fetchone()
    if not row:
        return {"enabled": False}
    return {
        "enabled": row[0],
        "on_sync_workout": row[1],
        "on_sync_run": row[2],
        "on_sync_error": row[3],
        "on_milestone": row[4],
        "on_playlist_ready": row[5],
    }


def _remove_subscription(sub_id: int):
    """Remove an expired/invalid subscription."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM push_subscriptions WHERE id = %s", (sub_id,))


def _update_last_used(sub_id: int):
    """Update last_used_at for a subscription."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = %s",
                (sub_id,),
            )


def send_push(
    title: str,
    body: str,
    url: str = "/",
    event_type: str = "sync",
    icon: str = "/icons/icon-192x192.png",
) -> int:
    """Send a push notification to all subscribed browsers.

    Checks preferences before sending. Removes expired subscriptions (410 Gone).
    Returns count of successful sends.
    """
    if not is_configured():
        logger.info("Push not configured (no VAPID keys)")
        return 0

    prefs = _get_preferences()
    if not prefs.get("enabled"):
        return 0

    pref_key = {
        "sync_workout": "on_sync_workout",
        "sync_run": "on_sync_run",
        "sync_error": "on_sync_error",
        "milestone": "on_milestone",
        "playlist_ready": "on_playlist_ready",
    }.get(event_type)
    if pref_key and not prefs.get(pref_key, True):
        return 0

    subscriptions = _get_subscriptions()
    if not subscriptions:
        return 0

    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url,
        "icon": icon,
        "event_type": event_type,
    })

    vapid_claims = {
        "sub": os.environ["VAPID_SUBJECT"],
    }

    sent = 0
    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub["endpoint"],
            "keys": {
                "p256dh": sub["p256dh"],
                "auth": sub["auth"],
            },
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
                vapid_claims=vapid_claims,
            )
            _update_last_used(sub["id"])
            sent += 1
        except WebPushException as e:
            if "410" in str(e) or "404" in str(e):
                logger.info("Removing expired subscription %s", sub["id"])
                _remove_subscription(sub["id"])
            else:
                logger.warning("Push failed for sub %s: %s", sub["id"], e)
        except Exception as e:
            logger.warning("Push failed for sub %s: %s", sub["id"], e)

    return sent

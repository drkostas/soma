"""Sync Strava activities into the raw data lake."""

from datetime import datetime, timedelta

from db import get_connection, upsert_strava_raw


def sync_recent_activities(client, after_timestamp=None, page_size=30, max_pages=5):
    """Pull recent activities from Strava into strava_raw_data.

    If after_timestamp is None, defaults to 7 days ago.
    Paginates until a partial page or max_pages reached.
    Returns total activities synced.
    """
    if after_timestamp is None:
        after_timestamp = int((datetime.utcnow() - timedelta(days=7)).timestamp())

    total = 0
    with get_connection() as conn:
        for page in range(1, max_pages + 1):
            activities = client.get_activities(
                after=after_timestamp, page=page, per_page=page_size,
            )
            for act in activities:
                upsert_strava_raw(conn, act["id"], "activity", act)
                total += 1
            print(f"  Strava page {page}: {len(activities)} activities")
            if len(activities) < page_size:
                break
    return total


def sync_activity_details(client, strava_id):
    """Fetch detailed data and streams for a single Strava activity."""
    with get_connection() as conn:
        detail = client.get_activity(strava_id)
        upsert_strava_raw(conn, strava_id, "detail", detail)

        try:
            streams = client.get_activity_streams(strava_id)
            upsert_strava_raw(conn, strava_id, "streams", streams)
        except Exception as e:
            print(f"  Warning: could not fetch streams for {strava_id}: {e}")


def sync_all_activity_details(client, activity_ids):
    """Fetch details for a list of activity IDs."""
    for i, aid in enumerate(activity_ids):
        print(f"  Strava detail {i+1}/{len(activity_ids)}: activity {aid}")
        sync_activity_details(client, aid)

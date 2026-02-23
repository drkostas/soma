"""Sync rule engine — matches activities to routing rules and checks anti-loop."""

from __future__ import annotations

import logging

from db import was_already_synced
from strava_push import push_workout_to_strava

logger = logging.getLogger(__name__)


def match_rules(rules, source_platform, activity_type):
    """Find all rules that match a given activity.

    A rule matches if:
    - source_platform matches exactly
    - activity_type matches exactly OR rule has wildcard '*'
    """
    matched = []
    for rule in rules:
        if rule["source_platform"] != source_platform:
            continue
        if rule["activity_type"] != "*" and rule["activity_type"] != activity_type:
            continue
        matched.append(rule)
    return matched


def should_sync(source_platform, destination, conn=None, source_id=None):
    """Check if an activity should be synced to a destination.

    Returns False if:
    - Destination is the same as source (anti-loop)
    - Activity was already successfully synced to this destination
    """
    if source_platform == destination:
        return False

    if conn is not None and source_id is not None:
        if was_already_synced(conn, source_platform, source_id, destination):
            return False

    return True


def execute_routes(
    rules: list[dict],
    source_platform: str,
    activity_type: str,
    workout: dict,
    hr_samples: list[int] | None,
    strava_client=None,
    conn=None,
) -> list[dict]:
    """Evaluate routing rules against a workout and dispatch to push connectors.

    Parameters
    ----------
    rules:
        List of routing rule dicts (from sync_rules table or config).
    source_platform:
        Platform the workout originated from (e.g. "hevy", "garmin").
    activity_type:
        Activity type string (e.g. "strength", "running").
    workout:
        Enriched workout dict.
    hr_samples:
        Heart-rate samples or None.
    strava_client:
        Optional StravaClient instance for Strava destinations.
    conn:
        Optional DB connection for anti-loop checks.

    Returns
    -------
    List of result dicts, one per dispatched destination, with keys:
        destination, rule_id, status, strava_activity_id, error
    """
    matched = match_rules(rules, source_platform, activity_type)
    if not matched:
        return []

    source_id = workout.get("hevy_id") or workout.get("activity_id") or ""
    results: list[dict] = []

    for rule in matched:
        rule_id = rule["id"]
        for dest in rule["destinations"]:
            destination = dest["platform"]

            if not should_sync(source_platform, destination, conn=conn, source_id=source_id):
                logger.info(
                    "Skipping rule %s -> %s for source_id=%s (anti-loop or already synced)",
                    rule_id, destination, source_id,
                )
                continue

            if destination == "strava" and strava_client is not None:
                push_result = push_workout_to_strava(
                    strava_client, workout, hr_samples, rule_id=rule_id,
                )
                results.append({
                    "destination": destination,
                    "rule_id": rule_id,
                    "status": push_result["status"],
                    "strava_activity_id": push_result.get("strava_activity_id"),
                    "error": push_result.get("error"),
                })
            else:
                logger.warning(
                    "No connector available for destination %r (rule %s)",
                    destination, rule_id,
                )

    return results

"""Sync rule engine — matches activities to routing rules and checks anti-loop."""

from db import was_already_synced


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

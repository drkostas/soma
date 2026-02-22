"""Delete a Garmin activity from both Garmin Connect and the local database."""

import sys

from garmin_client import init_garmin, rate_limited_call
from db import get_connection


def delete_activity(activity_id: int, skip_garmin: bool = False) -> dict:
    """Delete activity from Garmin Connect and database.

    Returns dict with deletion results.
    """
    result = {"activity_id": activity_id, "garmin_deleted": False, "db_rows_deleted": 0}

    # Step 1: Delete from Garmin Connect
    if not skip_garmin:
        try:
            client = init_garmin()
            rate_limited_call(client.delete_activity, str(activity_id))
            result["garmin_deleted"] = True
            print(f"Deleted activity {activity_id} from Garmin Connect")
        except Exception as e:
            print(f"Warning: Garmin deletion failed for {activity_id}: {e}")
            result["garmin_error"] = str(e)

    # Step 2: Delete from database
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM garmin_activity_raw WHERE activity_id = %s",
                (activity_id,),
            )
            result["db_rows_deleted"] = cur.rowcount
            print(f"Deleted {cur.rowcount} rows from garmin_activity_raw for activity {activity_id}")

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m src.delete_activity <activity_id> [--skip-garmin]")
        sys.exit(1)

    aid = int(sys.argv[1])
    skip = "--skip-garmin" in sys.argv
    result = delete_activity(aid, skip_garmin=skip)
    print(f"Result: {result}")

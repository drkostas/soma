"""
Training Engine Runner — Orchestrates all streams and merge.
Called from pipeline.py after the parse phase.
"""
import json
import logging
from datetime import date

from config import today_nyc

logger = logging.getLogger(__name__)

_DEFAULT_PACE = 330  # ~5:30/km fallback


def _extract_planned_pace(workout_steps_raw) -> float:
    """Extract a distance-weighted average pace from workout_steps JSONB.

    Looks at all steps with target_type == 'pace' and computes a weighted
    average using each step's distance (duration_value when duration_type
    is 'distance').  Falls back to the midpoint of target_pace_min/max.

    Returns _DEFAULT_PACE (~5:30/km) if no pace data is available.
    """
    if not workout_steps_raw:
        return _DEFAULT_PACE

    steps = workout_steps_raw
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except (json.JSONDecodeError, TypeError):
            return _DEFAULT_PACE

    if not isinstance(steps, list):
        return _DEFAULT_PACE

    total_distance = 0.0
    weighted_pace = 0.0

    for step in steps:
        if not isinstance(step, dict):
            continue
        if step.get("target_type") != "pace":
            continue

        pace_min = step.get("target_pace_min")
        pace_max = step.get("target_pace_max")
        if pace_min is None and pace_max is None:
            continue

        # Midpoint of pace range (or whichever is available)
        if pace_min is not None and pace_max is not None:
            pace = (pace_min + pace_max) / 2
        else:
            pace = pace_min if pace_min is not None else pace_max

        # Weight by distance if available, else treat as 1 unit
        if step.get("duration_type") == "distance" and step.get("duration_value"):
            dist = step["duration_value"]
        else:
            dist = 1000  # default 1 km weight for time-based steps

        weighted_pace += pace * dist
        total_distance += dist

    if total_distance > 0:
        return weighted_pace / total_distance

    return _DEFAULT_PACE


def _compute_hevy_loads(conn):
    """Extract Hevy workout data and insert into training_load table."""
    from datetime import datetime
    from training_engine.strength_load import compute_strength_load

    with conn.cursor() as cur:
        # Find Hevy workouts not yet in training_load
        cur.execute("""
            SELECT h.id, h.raw_json
            FROM hevy_raw_data h
            WHERE NOT EXISTS (
                SELECT 1 FROM training_load t
                WHERE t.hevy_id = h.id::text
            )
        """)
        rows = cur.fetchall()

    insert_params = []
    for hevy_id, raw_json in rows:
        if isinstance(raw_json, str):
            raw_json = json.loads(raw_json)

        # Extract exercises from Hevy raw data
        exercises = []
        for ex in raw_json.get("exercises", []):
            sets = []
            for s in ex.get("sets", []):
                weight = s.get("weight_kg", 0) or 0
                reps = s.get("reps", 0) or 0
                if weight > 0 and reps > 0:
                    sets.append({"weight_kg": weight, "reps": reps})
            if sets:
                exercises.append({"name": ex.get("title", ""), "sets": sets})

        # Get duration in minutes
        start = raw_json.get("start_time", "")
        end = raw_json.get("end_time", "")
        duration_min = 45  # default
        if start and end:
            try:
                t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
                duration_min = max(1, (t1 - t0).total_seconds() / 60)
            except (ValueError, TypeError):
                pass

        if not exercises:
            continue

        load = compute_strength_load(exercises, duration_min)

        # Parse workout date
        workout_date_str = raw_json.get("start_time", "")[:10]
        if not workout_date_str:
            continue

        try:
            workout_date = date.fromisoformat(workout_date_str)
        except ValueError:
            continue

        insert_params.append((
            workout_date,
            str(hevy_id),
            load["cross_modal_load"],
            int(duration_min * 60),
            json.dumps({
                "session_rpe": load["session_rpe"],
                "running_relevance": load["running_relevance"],
                "raw_load": load["load_value"],
            }),
        ))

    if insert_params:
        with conn.cursor() as cur:
            cur.executemany("""
                INSERT INTO training_load
                    (activity_date, hevy_id, source, load_metric, load_value,
                     duration_seconds, details)
                VALUES (%s, %s, 'hevy', 'srpe', %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, insert_params)

    conn.commit()


def _fresh_conn():
    """Get a fresh DB connection. Each step gets its own to prevent transaction cascade failures."""
    import psycopg2
    from config import DATABASE_URL
    return psycopg2.connect(DATABASE_URL)


def _run_step(name, func, *args):
    """Run a training engine step with its own connection. Commits on success, rolls back on failure."""
    conn = _fresh_conn()
    try:
        result = func(conn, *args)
        conn.commit()
        return result
    except Exception as e:
        conn.rollback()
        logger.error("Training engine: %s failed: %s", name, e)
        return None
    finally:
        conn.close()


def run_training_engine(conn=None):
    """
    Run all training engine streams and merge.
    Called from pipeline.py after parsing.

    Each step uses its own DB connection so a failure in one step
    doesn't put the transaction in an aborted state for subsequent steps.
    The conn parameter is accepted for backwards compatibility but ignored.
    """
    from training_engine.load_stream import backfill_load_from_history, compute_and_store_pmc
    from training_engine.readiness_stream import compute_daily_readiness
    from training_engine.fitness_stream import update_fitness_trajectory
    from training_engine.body_comp_stream import update_body_comp
    from training_engine.merge import merge

    today = today_nyc()

    # 1. Compute loads for new activities
    loads = _run_step("load computation", backfill_load_from_history) or []
    if loads:
        logger.info("Training engine: %d activity loads computed", len(loads))

    # 1b. Compute strength loads from Hevy workouts
    _run_step("strength loads", lambda conn: _compute_hevy_loads(conn))

    # 2. Recompute PMC
    pmc = _run_step("PMC", compute_and_store_pmc) or []
    if pmc:
        logger.info("Training engine: PMC computed for %d days", len(pmc))

    # 2b. Try Banister fitting for personal tau values
    try:
        from training_engine.banister import fit_from_db, _DEFAULT_PARAMS
        banister_params = _run_step("Banister fitting", fit_from_db)
        if banister_params and abs(banister_params.tau1 - _DEFAULT_PARAMS.tau1) > 0.5:
            logger.info("Training engine: Banister fitted, re-running PMC with personal tau")
            pmc = _run_step("PMC (personal tau)", compute_and_store_pmc,
                            banister_params.tau1, banister_params.tau2) or pmc
    except Exception as e:
        logger.error("Training engine: Banister fitting failed (using defaults): %s", e)

    # 3. Today's readiness
    readiness = _run_step("readiness", compute_daily_readiness, today)
    if readiness:
        logger.info("Training engine: readiness=%s (z=%.2f)",
                    readiness.get("traffic_light"), readiness.get("composite_score", 0))
    else:
        logger.info("Training engine: insufficient data for readiness")

    # 3b. Advance calibration
    try:
        from training_engine.calibration import advance_calibration, CalibrationState

        def _run_calibration(conn):
            calib_state = None
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT phase, data_days, weights, correlations, force_equal
                        FROM calibration_state WHERE id = 1
                    """)
                    row = cur.fetchone()
                if row:
                    db_phase, db_data_days, db_weights, db_correlations, db_force_equal = row
                    if isinstance(db_weights, str):
                        db_weights = json.loads(db_weights)
                    if isinstance(db_correlations, str):
                        db_correlations = json.loads(db_correlations)
                    calib_state = CalibrationState(
                        phase=db_phase, data_days=db_data_days, weights=db_weights,
                        correlations=db_correlations, force_equal=db_force_equal,
                    )
            except Exception:
                pass
            if calib_state is None:
                calib_state = CalibrationState(
                    phase=1, data_days=0,
                    weights={"hrv": 0.25, "sleep": 0.25, "rhr": 0.25, "bb": 0.25},
                    force_equal=False,
                )
            return advance_calibration(conn, calib_state)

        updated_calib = _run_step("calibration", _run_calibration)
        if updated_calib:
            logger.info("Training engine: calibration phase=%d, data_days=%d, weights=%s",
                         updated_calib.phase, updated_calib.data_days, updated_calib.weights)
    except Exception as e:
        logger.error("Training engine: calibration failed: %s", e)

    # 3c. Sequencing enforcement
    try:
        from training_engine.sequencing import check_leg_day_conflict

        def _run_sequencing(conn):
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT day_date, gym_workout FROM training_plan_day
                    WHERE plan_id = (SELECT id FROM training_plan WHERE status = 'active' LIMIT 1)
                      AND gym_workout IS NOT NULL
                      AND day_date BETWEEN %s - interval '3 days' AND %s
                """, (today, today))
                recent_gym = [{"date": r[0], "gym_workout": r[1]} for r in cur.fetchall()]
                cur.execute("""
                    SELECT run_type FROM training_plan_day
                    WHERE plan_id = (SELECT id FROM training_plan WHERE status = 'active' LIMIT 1)
                      AND day_date = %s
                """, (today,))
                today_run = cur.fetchone()
            return {"today_run": today_run, "recent_gym": recent_gym}

        seq = _run_step("sequencing", _run_sequencing)
        if seq and seq.get("today_run") and seq.get("recent_gym"):
            has_conflict = check_leg_day_conflict(today, seq["today_run"][0], seq["recent_gym"])
            if has_conflict and readiness:
                original_z = readiness.get("composite_score", 0)
                readiness["composite_score"] = original_z - 0.3
                logger.info("Training engine: sequencing conflict, z penalty applied (%.2f -> %.2f)",
                            original_z, readiness["composite_score"])
    except Exception as e:
        logger.error("Training engine: sequencing check failed: %s", e)

    # 4. Fitness trajectory
    fitness = _run_step("fitness trajectory", update_fitness_trajectory, today)
    if fitness:
        logger.info("Training engine: VO2max=%s", fitness.get("vo2max"))

    # 5. Body comp
    body = _run_step("body comp", update_body_comp, today)
    if body:
        logger.info("Training engine: weight=%.1f kg", body.get("weight_kg", 0))

    # 6. Merge all streams
    try:
        load_output = {}
        if pmc:
            last_pmc = pmc[-1]
            load_output = {"ctl": last_pmc["ctl"], "atl": last_pmc["atl"], "tsb": last_pmc["tsb"]}

        readiness_output = readiness or {"composite_score": 0.0, "traffic_light": "green"}

        fitness_output = {}
        if fitness:
            fitness_output = {
                "vo2max": fitness.get("vo2max"),
                "decoupling_pct": fitness.get("decoupling_pct"),
            }

        body_output = {}
        if body:
            body_output = {
                "weight_ema": body.get("weight_kg"),
                "vdot_adjusted": body.get("vdot_adjusted"),
                "calibration_weight_kg": body.get("calibration_weight_kg"),
            }

        merged = merge(load_output, readiness_output, fitness_output, body_output)
        logger.info("Training engine: merged — pace=%s, light=%s, TSB=%.1f",
                     merged.get("adjusted_pace"), merged.get("traffic_light"),
                     merged.get("tsb", 0))
    except Exception as e:
        logger.error("Training engine: merge failed: %s", e)

    # 7. Compute session quality for matched plan days
    try:
        from training_engine.session_quality import compute_session_quality

        def _run_session_quality(conn):
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT d.id, d.run_type,
                           g.raw_json, d.workout_steps
                    FROM training_plan_day d
                    JOIN training_plan p ON d.plan_id = p.id
                    JOIN garmin_activity_raw g ON g.activity_id::text = d.garmin_workout_id
                    WHERE p.status = 'active'
                      AND d.garmin_workout_id IS NOT NULL
                      AND d.session_quality_score IS NULL
                      AND g.endpoint_name = 'summary'
                """)
                matched = cur.fetchall()

            count = 0
            for day_id, run_type, raw_json, workout_steps_raw in matched:
                if run_type == 'rest':
                    continue
                data = raw_json if isinstance(raw_json, dict) else json.loads(raw_json)
                actual_duration = data.get('duration', 0)
                actual_distance = data.get('distance', 0)
                actual_hr = data.get('averageHR')

                if actual_distance > 0 and actual_duration > 0:
                    actual_pace = actual_duration / (actual_distance / 1000)
                    planned_pace = _extract_planned_pace(workout_steps_raw)
                    planned_hr = 150

                    quality = compute_session_quality(planned_pace, actual_pace, planned_hr, actual_hr)
                    if quality is not None:
                        with conn.cursor() as cur:
                            cur.execute("""
                                UPDATE training_plan_day SET session_quality_score = %s WHERE id = %s
                            """, (quality, day_id))
                        count += 1
            return count

        count = _run_step("session quality", _run_session_quality) or 0
        logger.info("Training engine: session quality computed for %d matched days", count)
    except Exception as e:
        logger.error("Training engine: session quality failed: %s", e)

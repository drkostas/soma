"""
Training Engine Runner — Orchestrates all streams and merge.
Called from pipeline.py after the parse phase.
"""
import json
import logging
from datetime import date

logger = logging.getLogger(__name__)


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

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO training_load
                    (activity_date, hevy_id, source, load_metric, load_value,
                     duration_seconds, details)
                VALUES (%s, %s, 'hevy', 'srpe', %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
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

    conn.commit()


def run_training_engine(conn):
    """
    Run all training engine streams and merge.
    Called from pipeline.py after parsing.

    Steps:
    1. Compute load for any new activities (backfill_load_from_history)
    1b. Compute strength loads from Hevy workouts
    2. Recompute PMC (compute_and_store_pmc)
    3. Compute today's readiness (compute_daily_readiness)
    4. Update fitness trajectory (update_fitness_trajectory)
    5. Update body comp (update_body_comp)
    6. Merge all stream outputs
    7. Log results

    Each step is wrapped in try/except so one failure doesn't block others.
    """
    from training_engine.load_stream import backfill_load_from_history, compute_and_store_pmc
    from training_engine.readiness_stream import compute_daily_readiness
    from training_engine.fitness_stream import update_fitness_trajectory
    from training_engine.body_comp_stream import update_body_comp
    from training_engine.merge import merge

    today = date.today()

    # 1. Compute loads for new activities
    try:
        loads = backfill_load_from_history(conn)
        logger.info("Training engine: %d activity loads computed", len(loads))
    except Exception as e:
        logger.error("Training engine: load computation failed: %s", e)
        loads = []

    # 1b. Compute strength loads from Hevy workouts
    try:
        _compute_hevy_loads(conn)
        logger.info("Training engine: strength loads computed")
    except Exception as e:
        logger.error("Training engine: strength load computation failed: %s", e)

    # 2. Recompute PMC
    pmc = []
    try:
        pmc = compute_and_store_pmc(conn)
        logger.info("Training engine: PMC computed for %d days", len(pmc))
    except Exception as e:
        logger.error("Training engine: PMC computation failed: %s", e)

    # 2b. Try Banister fitting for personal tau values
    banister_params = None
    try:
        from training_engine.banister import fit_from_db, _DEFAULT_PARAMS
        banister_params = fit_from_db(conn)
        if banister_params and abs(banister_params.tau1 - _DEFAULT_PARAMS.tau1) > 0.5:
            logger.info("Training engine: Banister fitted — τ1=%.1f, τ2=%.1f",
                        banister_params.tau1, banister_params.tau2)
            # Re-run PMC with personal tau
            pmc = compute_and_store_pmc(conn, tau_ctl=banister_params.tau1, tau_atl=banister_params.tau2)
            logger.info("Training engine: PMC re-computed with personal τ values")
    except Exception as e:
        logger.error("Training engine: Banister fitting failed (using defaults): %s", e)

    # 3. Today's readiness
    readiness = None
    try:
        readiness = compute_daily_readiness(conn, today)
        if readiness:
            logger.info("Training engine: readiness=%s (z=%.2f)",
                        readiness.get("traffic_light"), readiness.get("composite_score", 0))
        else:
            logger.info("Training engine: insufficient data for readiness")
    except Exception as e:
        logger.error("Training engine: readiness computation failed: %s", e)

    # 3b. Advance calibration
    try:
        from training_engine.calibration import advance_calibration, CalibrationState
        calib_state = CalibrationState(
            phase=1, data_days=0, weights={"hrv": 0.25, "sleep": 0.25, "rhr": 0.25, "bb": 0.25},
            force_equal=False,
        )
        updated_calib = advance_calibration(conn, calib_state)
        logger.info("Training engine: calibration phase=%d, data_days=%d, weights=%s",
                     updated_calib.phase, updated_calib.data_days, updated_calib.weights)
    except Exception as e:
        logger.error("Training engine: calibration failed: %s", e)

    # 4. Fitness trajectory
    fitness = None
    try:
        fitness = update_fitness_trajectory(conn, today)
        if fitness:
            logger.info("Training engine: VO2max=%s", fitness.get("vo2max"))
    except Exception as e:
        logger.error("Training engine: fitness update failed: %s", e)

    # 5. Body comp
    body = None
    try:
        body = update_body_comp(conn, today)
        if body:
            logger.info("Training engine: weight=%.1f kg", body.get("weight_kg", 0))
    except Exception as e:
        logger.error("Training engine: body comp update failed: %s", e)

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
        with conn.cursor() as cur:
            cur.execute("""
                SELECT d.id, d.run_type,
                       g.raw_json
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
        for day_id, run_type, raw_json in matched:
            if run_type == 'rest':
                continue
            data = raw_json if isinstance(raw_json, dict) else json.loads(raw_json)
            actual_duration = data.get('duration', 0)
            actual_distance = data.get('distance', 0)
            actual_hr = data.get('averageHR')

            if actual_distance > 0 and actual_duration > 0:
                actual_pace = actual_duration / (actual_distance / 1000)
                planned_pace = 330  # ~5:30/km default, refined by forward sim later
                planned_hr = 150  # default, refined later

                quality = compute_session_quality(planned_pace, actual_pace, planned_hr, actual_hr)
                if quality is not None:
                    with conn.cursor() as cur:
                        cur.execute("""
                            UPDATE training_plan_day SET session_quality_score = %s WHERE id = %s
                        """, (quality, day_id))
                    count += 1
        conn.commit()
        logger.info("Training engine: session quality computed for %d matched days", count)
    except Exception as e:
        logger.error("Training engine: session quality failed: %s", e)

#!/usr/bin/env python3
"""
Standalone training engine runner.
Usage: cd sync && PYTHONPATH=src python3 -m training_engine.run_engine
"""
import logging
from datetime import date, timedelta

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run_full_engine():
    import psycopg2
    from config import DATABASE_URL, today_nyc
    from training_engine.runner import run_training_engine, _run_step
    from training_engine.load_stream import backfill_load_from_history, compute_and_store_pmc
    from training_engine.readiness_stream import compute_daily_readiness
    from training_engine.fitness_stream import update_fitness_trajectory

    today = today_nyc()

    # 1. Backfill loads
    logger.info("=== Step 1: Backfill activity loads ===")
    loads = _run_step("load backfill", backfill_load_from_history) or []
    logger.info("Activity loads: %d inserted", len(loads))

    # 2. PMC
    logger.info("=== Step 2: Compute PMC ===")
    pmc = _run_step("PMC", compute_and_store_pmc) or []
    if pmc:
        last = pmc[-1]
        logger.info("PMC: %d days, latest: CTL=%.1f ATL=%.1f TSB=%.1f",
                     len(pmc), last["ctl"], last["atl"], last["tsb"])

    # 3. Readiness for last 30 days
    logger.info("=== Step 3: Compute readiness (last 30 days) ===")
    readiness_count = 0
    for i in range(30):
        target = today - timedelta(days=i)
        result = _run_step(f"readiness {target}", compute_daily_readiness, target)
        if result and result.get("traffic_light"):
            readiness_count += 1
            if i == 0:
                logger.info("Today: light=%s, composite=%.2f, flags=%s",
                            result["traffic_light"], result["composite_score"], result.get("flags", []))
    logger.info("Readiness computed for %d days", readiness_count)

    # 4. Fitness trajectory for last 90 days (weekly samples)
    logger.info("=== Step 4: Compute fitness trajectory ===")
    fitness_count = 0
    for i in range(0, 90, 7):
        target = today - timedelta(days=i)
        result = _run_step(f"fitness {target}", update_fitness_trajectory, target)
        if result:
            fitness_count += 1
            if i == 0:
                logger.info("Today: VO2max=%s, EF=%s, decoupling=%s%%",
                            result.get("vo2max"), result.get("efficiency_factor"),
                            result.get("decoupling_pct"))
    logger.info("Fitness trajectory computed for %d dates", fitness_count)

    # 5. Run full training engine (merge step)
    logger.info("=== Step 5: Merge ===")
    _run_step("merge", lambda conn: run_training_engine())

    logger.info("=== Done ===")


if __name__ == "__main__":
    run_full_engine()

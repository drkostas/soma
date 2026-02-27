"""Generate rich Strava descriptions for strength workouts.

Produces a text description with full exercise/set detail, average HR per exercise,
PR highlights, and new exercise flags.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from db import get_connection

logger = logging.getLogger(__name__)


def _format_weight(kg: float) -> str:
    """Format weight in kg, rounding neatly."""
    if kg == 0:
        return "BW"
    rounded = round(kg, 1)
    if rounded == int(rounded):
        return f"{int(rounded)}kg"
    return f"{rounded}kg"


def _format_duration(seconds: float) -> str:
    """Format duration as Xh Ym."""
    minutes = int(seconds / 60)
    if minutes >= 60:
        h, m = divmod(minutes, 60)
        return f"{h}h {m}m"
    return f"{minutes}m"


def _slice_hr_by_exercise(hr_samples: list[int], exercises: list[dict]) -> list[float | None]:
    """Split HR samples across exercises proportionally by set count.

    Returns average HR per exercise, or None if no samples available.
    """
    if not hr_samples or not exercises:
        return [None] * len(exercises)

    total_sets = sum(len(ex.get("sets", [])) for ex in exercises)
    if total_sets == 0:
        return [None] * len(exercises)

    result = []
    offset = 0
    n = len(hr_samples)

    for ex in exercises:
        ex_sets = len(ex.get("sets", []))
        # Proportional slice of HR samples
        slice_size = max(1, int(n * ex_sets / total_sets))
        end = min(offset + slice_size, n)
        chunk = hr_samples[offset:end]
        if chunk:
            result.append(round(sum(chunk) / len(chunk)))
        else:
            result.append(None)
        offset = end

    return result


def compute_prs(hevy_id: str, exercises: list[dict], workout_start_time: str | None = None) -> dict:
    """Compute PRs by comparing current workout against prior workouts only.

    When workout_start_time is provided, only considers workouts that started
    before this time — giving historically accurate PR flags.

    Returns dict keyed by exercise_template_id:
    {
        "TEMPLATE_ID": {
            "weight_pr": {"new": 100.0, "prev": 95.0} | None,
            "volume_pr": {"new": 1540.0, "prev": 1500.0} | None,
            "set_pr": {"new": 500.0, "prev": 480.0} | None,
            "is_new": bool,
        }
    }
    """
    template_ids = [ex["exercise_template_id"] for ex in exercises if ex.get("exercise_template_id")]
    if not template_ids:
        return {}

    # Load only historical workouts that share at least one exercise template —
    # avoids full-table reads by scoping to relevant exercise history only.
    with get_connection() as conn:
        with conn.cursor() as cur:
            if workout_start_time:
                cur.execute("""
                    SELECT hevy_id, raw_json->'exercises' as exercises
                    FROM hevy_raw_data
                    WHERE endpoint_name = 'workout'
                      AND hevy_id != %s
                      AND raw_json->>'start_time' < %s
                      AND EXISTS (
                          SELECT 1 FROM jsonb_array_elements(raw_json->'exercises') AS ex
                          WHERE ex->>'exercise_template_id' = ANY(%s::text[])
                      )
                    ORDER BY raw_json->>'start_time' ASC
                """, (hevy_id, workout_start_time, template_ids))
            else:
                cur.execute("""
                    SELECT hevy_id, raw_json->'exercises' as exercises
                    FROM hevy_raw_data
                    WHERE endpoint_name = 'workout'
                      AND hevy_id != %s
                      AND EXISTS (
                          SELECT 1 FROM jsonb_array_elements(raw_json->'exercises') AS ex
                          WHERE ex->>'exercise_template_id' = ANY(%s::text[])
                      )
                    ORDER BY raw_json->>'start_time' ASC
                """, (hevy_id, template_ids))
            rows = cur.fetchall()

    # Build historical bests per template
    # best_weight[template] = max weight in any single normal set
    # best_volume[template] = max total volume (sum of weight*reps) in one workout
    # best_set[template] = max single set weight*reps
    best_weight: dict[str, float] = {}
    best_volume: dict[str, float] = {}
    best_set: dict[str, float] = {}
    seen_templates: set[str] = set()

    for row_hevy_id, exs_json in rows:
        exs = json.loads(exs_json) if isinstance(exs_json, str) else exs_json
        if not exs:
            continue
        for ex in exs:
            tid = ex.get("exercise_template_id")
            if not tid:
                continue
            seen_templates.add(tid)

            sets = ex.get("sets", [])
            normal_sets = [s for s in sets if s.get("type") == "normal"]

            for s in normal_sets:
                w = s.get("weight_kg") or 0
                r = s.get("reps") or 0
                if w > best_weight.get(tid, 0):
                    best_weight[tid] = w
                sv = w * r
                if sv > best_set.get(tid, 0):
                    best_set[tid] = sv

            vol = sum((s.get("weight_kg") or 0) * (s.get("reps") or 0) for s in normal_sets)
            if vol > best_volume.get(tid, 0):
                best_volume[tid] = vol

    # Compare current workout
    result = {}
    for ex in exercises:
        tid = ex.get("exercise_template_id")
        if not tid:
            continue

        sets = ex.get("sets", [])
        normal_sets = [s for s in sets if s.get("type") == "normal"]

        is_new = tid not in seen_templates

        # Current bests
        cur_max_weight = max((s.get("weight_kg") or 0 for s in normal_sets), default=0)
        cur_volume = sum((s.get("weight_kg") or 0) * (s.get("reps") or 0) for s in normal_sets)
        cur_max_set = max(((s.get("weight_kg") or 0) * (s.get("reps") or 0) for s in normal_sets), default=0)

        pr_info: dict = {"is_new": is_new, "weight_pr": None, "volume_pr": None, "set_pr": None}

        if not is_new:
            prev_w = best_weight.get(tid, 0)
            if cur_max_weight > prev_w and cur_max_weight > 0:
                pr_info["weight_pr"] = {"new": cur_max_weight, "prev": prev_w}

            prev_v = best_volume.get(tid, 0)
            if cur_volume > prev_v and cur_volume > 0:
                pr_info["volume_pr"] = {"new": cur_volume, "prev": prev_v}

            prev_s = best_set.get(tid, 0)
            if cur_max_set > prev_s and cur_max_set > 0:
                pr_info["set_pr"] = {"new": cur_max_set, "prev": prev_s}

        result[tid] = pr_info

    return result


def generate_description(
    hevy_id: str,
    workout_json: dict,
    enrichment: dict,
    hr_samples: list[int] | None = None,
) -> str:
    """Generate a rich Strava description for a strength workout.

    Args:
        hevy_id: Hevy workout ID
        workout_json: Raw Hevy workout JSON
        enrichment: Dict with keys: avg_hr, max_hr, calories, duration_s
        hr_samples: Flat list of HR values (evenly spaced across workout)

    Returns:
        Formatted description string
    """
    title = workout_json.get("title", "Workout")
    exercises = workout_json.get("exercises", [])
    workout_desc = workout_json.get("description", "")
    duration_s = enrichment.get("duration_s") or 0

    # Compute duration from Hevy timestamps if enrichment doesn't have it
    if not duration_s:
        start = workout_json.get("start_time")
        end = workout_json.get("end_time")
        if start and end:
            try:
                t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
                duration_s = (t1 - t0).total_seconds()
            except (ValueError, TypeError):
                pass

    avg_hr = enrichment.get("avg_hr")
    max_hr = enrichment.get("max_hr")
    calories = enrichment.get("calories")

    # Compute volume and working-set count
    total_sets = 0
    total_volume = 0.0
    for ex in exercises:
        for s in ex.get("sets", []):
            if s.get("type") == "normal" and (s.get("weight_kg") or 0) > 0 and (s.get("reps") or 0) > 0:
                total_sets += 1
                total_volume += (s.get("weight_kg") or 0) * (s.get("reps") or 0)
    volume_str = (
        f"{total_volume / 1000:.1f}t" if total_volume >= 1000
        else f"{round(total_volume)}kg"
    ) if total_volume > 0 else None

    # ── Header: title + duration ──────────────────────────────────────────────
    lines = [f"\U0001f3cb\ufe0f {title}  \u2014  {_format_duration(duration_s)}"]
    if workout_desc:
        lines.append(f'"{workout_desc}"')

    # ── Stats lines (run-description style with · separator) ──────────────────
    # Line 1: primary vitals
    p1 = []
    if total_sets > 0:
        p1.append(f"\U0001f4aa {total_sets} sets")
    if volume_str:
        p1.append(f"\U0001f4ca {volume_str} volume")
    if avg_hr:
        p1.append(f"\u2764\ufe0f {avg_hr} bpm avg")
    if p1:
        lines.append("  \u00b7  ".join(p1))

    # Line 2: secondary vitals
    p2 = []
    if calories:
        p2.append(f"\U0001f525 {calories} kcal")
    if max_hr:
        p2.append(f"Max HR: {max_hr} bpm")
    if exercises:
        p2.append(f"{len(exercises)} exercises")
    if p2:
        lines.append("  \u00b7  ".join(p2))

    lines.append("")

    # ── Compute PRs + per-exercise HR ─────────────────────────────────────────
    workout_start = workout_json.get("start_time")
    prs = compute_prs(hevy_id, exercises, workout_start_time=workout_start)
    ex_hr = _slice_hr_by_exercise(hr_samples or [], exercises)

    # ── Exercises ─────────────────────────────────────────────────────────────
    for i, ex in enumerate(exercises):
        ex_title = ex.get("title", "Unknown")
        hr_avg = ex_hr[i] if i < len(ex_hr) else None

        if hr_avg:
            lines.append(f"{ex_title}  \u2764\ufe0f {hr_avg} bpm")
        else:
            lines.append(ex_title)

        sets = ex.get("sets", [])
        for j, s in enumerate(sets):
            set_num = j + 1
            weight = s.get("weight_kg") or 0
            reps = s.get("reps") or 0
            set_type = s.get("type", "normal")
            rpe = s.get("rpe")

            w_str = _format_weight(weight)
            suffix = ""
            if set_type == "warmup":
                suffix = "  (warmup)"
            elif rpe:
                suffix = f"  @RPE {rpe}"

            if weight > 0:
                lines.append(f"  {set_num}. {w_str} \u00d7 {reps}{suffix}")
            elif reps > 0:
                lines.append(f"  {set_num}. BW \u00d7 {reps}{suffix}")
            else:
                dur = s.get("duration_seconds")
                if dur:
                    lines.append(f"  {set_num}. {int(dur)}s{suffix}")
                else:
                    lines.append(f"  {set_num}. \u2014{suffix}")

        notes = ex.get("notes", "")
        if notes:
            lines.append(f"  \U0001f4dd {notes}")

        # PR flags
        tid = ex.get("exercise_template_id")
        pr = prs.get(tid, {})
        if pr.get("is_new"):
            lines.append("  \U0001f195 First time!")
        else:
            if pr.get("weight_pr"):
                p = pr["weight_pr"]
                lines.append(f"  \U0001f3c6 Weight PR: {_format_weight(p['new'])} (prev: {_format_weight(p['prev'])})")
            if pr.get("volume_pr"):
                p = pr["volume_pr"]
                lines.append(f"  \U0001f4c8 Volume PR: {_format_weight(p['new'])} (prev: {_format_weight(p['prev'])})")
            if pr.get("set_pr"):
                p = pr["set_pr"]
                lines.append(f"  \u26a1 Set PR: {_format_weight(p['new'])} (prev: {_format_weight(p['prev'])})")

        lines.append("")

    # ── Footer ────────────────────────────────────────────────────────────────
    lines.append("Tracked by github.com/drkostas/soma")

    return "\n".join(lines)

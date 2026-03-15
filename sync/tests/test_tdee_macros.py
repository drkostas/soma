from nutrition_engine.tdee import compute_macro_targets

def test_macros_sum_to_target_calories():
    """P*4 + C*4 + F*9 must never exceed target calories."""
    result = compute_macro_targets(
        tdee=2600, deficit=800, weight_kg=79.2,
        exercise_calories=0, training_day_type="rest",
        protein_g_per_kg=2.2, fat_g_per_kg=0.8,
    )
    macro_cal = result["protein"] * 4 + result["carbs"] * 4 + result["fat"] * 9
    assert abs(macro_cal - result["calories"]) <= 9, (
        f"Macro cal ({macro_cal}) != target ({result['calories']}), diff={macro_cal - result['calories']}"
    )

def test_macros_sum_with_exercise():
    """With exercise calories, macros should still sum correctly."""
    result = compute_macro_targets(
        tdee=2600, deficit=800, weight_kg=79.2,
        exercise_calories=500, training_day_type="hard_run",
        protein_g_per_kg=2.2, fat_g_per_kg=0.8,
    )
    macro_cal = result["protein"] * 4 + result["carbs"] * 4 + result["fat"] * 9
    assert abs(macro_cal - result["calories"]) <= 9

def test_carb_floor_does_not_exceed_budget():
    """Carb floor should be soft — never push total above target."""
    result = compute_macro_targets(
        tdee=1800, deficit=500, weight_kg=79.2,
        exercise_calories=0, training_day_type="rest",
        protein_g_per_kg=2.2, fat_g_per_kg=0.8,
    )
    macro_cal = result["protein"] * 4 + result["carbs"] * 4 + result["fat"] * 9
    assert macro_cal <= result["calories"] + 9

def test_protein_and_fat_correct():
    """Protein and fat should match g/kg targets."""
    result = compute_macro_targets(
        tdee=2600, deficit=800, weight_kg=79.2,
        exercise_calories=0, training_day_type="rest",
        protein_g_per_kg=2.2, fat_g_per_kg=0.8,
    )
    assert result["protein"] == round(79.2 * 2.2)  # 174
    assert result["fat"] == round(79.2 * 0.8)      # 63

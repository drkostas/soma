"""Seed ingredient library, preset meals, and drink database — Task 2.

All nutrition values are USDA-verified per 100g (raw weight where applicable).
"""

# ---------------------------------------------------------------------------
# Ingredient library (22 items)
# ---------------------------------------------------------------------------

INGREDIENTS = {
    "chicken_breast_raw": {
        "name": "Chicken Breast (raw)",
        "calories_per_100g": 120,
        "protein_per_100g": 22.5,
        "carbs_per_100g": 0,
        "fat_per_100g": 2.6,
        "fiber_per_100g": 0,
        "is_raw": True,
        "raw_to_cooked_ratio": 0.75,
        "category": "protein",
    },
    "salmon_raw": {
        "name": "Salmon (raw)",
        "calories_per_100g": 208,
        "protein_per_100g": 20.4,
        "carbs_per_100g": 0,
        "fat_per_100g": 13.4,
        "fiber_per_100g": 0,
        "is_raw": True,
        "raw_to_cooked_ratio": 0.75,
        "category": "protein",
    },
    "eggs_whole": {
        "name": "Eggs (whole)",
        "calories_per_100g": 143,
        "protein_per_100g": 12.6,
        "carbs_per_100g": 0.7,
        "fat_per_100g": 9.5,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": 1.0,
        "category": "protein",
    },
    "white_rice_raw": {
        "name": "White Rice (raw)",
        "calories_per_100g": 365,
        "protein_per_100g": 7.1,
        "carbs_per_100g": 80,
        "fat_per_100g": 0.7,
        "fiber_per_100g": 1.3,
        "is_raw": True,
        "raw_to_cooked_ratio": 3.0,
        "category": "carbs",
    },
    "oats_dry": {
        "name": "Oats (dry)",
        "calories_per_100g": 389,
        "protein_per_100g": 16.9,
        "carbs_per_100g": 66.3,
        "fat_per_100g": 6.9,
        "fiber_per_100g": 10.6,
        "is_raw": True,
        "raw_to_cooked_ratio": 2.75,
        "category": "carbs",
    },
    "bread_whole_wheat": {
        "name": "Bread (whole wheat)",
        "calories_per_100g": 247,
        "protein_per_100g": 13,
        "carbs_per_100g": 41,
        "fat_per_100g": 3.4,
        "fiber_per_100g": 6,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "carbs",
    },
    "broccoli_raw": {
        "name": "Broccoli (raw)",
        "calories_per_100g": 34,
        "protein_per_100g": 2.8,
        "carbs_per_100g": 7,
        "fat_per_100g": 0.4,
        "fiber_per_100g": 2.6,
        "is_raw": True,
        "raw_to_cooked_ratio": 0.85,
        "category": "vegetable",
    },
    "cherry_tomatoes": {
        "name": "Cherry Tomatoes",
        "calories_per_100g": 18,
        "protein_per_100g": 0.9,
        "carbs_per_100g": 3.9,
        "fat_per_100g": 0.2,
        "fiber_per_100g": 1.2,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "vegetable",
    },
    "cucumber": {
        "name": "Cucumber",
        "calories_per_100g": 15,
        "protein_per_100g": 0.7,
        "carbs_per_100g": 3.6,
        "fat_per_100g": 0.1,
        "fiber_per_100g": 0.5,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "vegetable",
    },
    "carrots_raw": {
        "name": "Carrots (raw)",
        "calories_per_100g": 41,
        "protein_per_100g": 0.9,
        "carbs_per_100g": 9.6,
        "fat_per_100g": 0.2,
        "fiber_per_100g": 2.8,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "vegetable",
    },
    "avocado": {
        "name": "Avocado",
        "calories_per_100g": 160,
        "protein_per_100g": 2,
        "carbs_per_100g": 8.5,
        "fat_per_100g": 14.7,
        "fiber_per_100g": 6.7,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "fat",
    },
    "olive_oil": {
        "name": "Olive Oil",
        "calories_per_100g": 884,
        "protein_per_100g": 0,
        "carbs_per_100g": 0,
        "fat_per_100g": 100,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "fat",
    },
    "greek_yogurt_2pct": {
        "name": "Greek Yogurt 2%",
        "calories_per_100g": 73,
        "protein_per_100g": 10,
        "carbs_per_100g": 3.6,
        "fat_per_100g": 2,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "dairy",
    },
    "milk_2pct": {
        "name": "Milk 2%",
        "calories_per_100g": 50,
        "protein_per_100g": 3.4,
        "carbs_per_100g": 4.8,
        "fat_per_100g": 2,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "dairy",
    },
    "cottage_cheese_2pct": {
        "name": "Cottage Cheese 2%",
        "calories_per_100g": 86,
        "protein_per_100g": 11.8,
        "carbs_per_100g": 4.3,
        "fat_per_100g": 2.3,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "dairy",
    },
    "protein_powder_whey": {
        "name": "Protein Powder (whey)",
        "calories_per_100g": 375,
        "protein_per_100g": 75,
        "carbs_per_100g": 12.5,
        "fat_per_100g": 3.8,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "supplement",
    },
    "banana": {
        "name": "Banana",
        "calories_per_100g": 89,
        "protein_per_100g": 1.1,
        "carbs_per_100g": 22.8,
        "fat_per_100g": 0.3,
        "fiber_per_100g": 2.6,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "fruit",
    },
    "orange": {
        "name": "Orange",
        "calories_per_100g": 47,
        "protein_per_100g": 0.9,
        "carbs_per_100g": 11.8,
        "fat_per_100g": 0.1,
        "fiber_per_100g": 2.4,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "fruit",
    },
    "raos_arrabiata": {
        "name": "Rao's Arrabiata Sauce",
        "calories_per_100g": 80,
        "protein_per_100g": 1.4,
        "carbs_per_100g": 7,
        "fat_per_100g": 5.4,
        "fiber_per_100g": 1.4,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "sauce",
    },
    "purely_elizabeth_granola": {
        "name": "Purely Elizabeth Granola",
        "calories_per_100g": 480,
        "protein_per_100g": 10,
        "carbs_per_100g": 56,
        "fat_per_100g": 24,
        "fiber_per_100g": 6,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "carbs",
    },
    "energy_gel": {
        "name": "Energy Gel",
        "calories_per_100g": 286,
        "protein_per_100g": 0,
        "carbs_per_100g": 71,
        "fat_per_100g": 0,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "supplement",
    },
    "sports_drink": {
        "name": "Sports Drink",
        "calories_per_100g": 26,
        "protein_per_100g": 0,
        "carbs_per_100g": 6.4,
        "fat_per_100g": 0,
        "fiber_per_100g": 0,
        "is_raw": False,
        "raw_to_cooked_ratio": None,
        "category": "supplement",
    },
}


# ---------------------------------------------------------------------------
# Preset meals (10 items)
# ---------------------------------------------------------------------------

PRESET_MEALS = {
    "eggs_avocado_toast": {
        "name": "Eggs & Avocado Toast",
        "items": [
            {"ingredient_id": "eggs_whole", "grams": 150},        # ~3 eggs
            {"ingredient_id": "avocado", "grams": 50},            # half small
            {"ingredient_id": "bread_whole_wheat", "grams": 60},  # 2 slices
            {"ingredient_id": "olive_oil", "grams": 5},           # cooking
        ],
        "tags": ["breakfast"],
    },
    "protein_oats": {
        "name": "Protein Oats",
        "items": [
            {"ingredient_id": "oats_dry", "grams": 80},
            {"ingredient_id": "protein_powder_whey", "grams": 30},
            {"ingredient_id": "milk_2pct", "grams": 200},
            {"ingredient_id": "banana", "grams": 120},           # 1 medium
        ],
        "tags": ["breakfast"],
    },
    "chicken_veggie_plate": {
        "name": "Chicken Veggie Plate",
        "items": [
            {"ingredient_id": "chicken_breast_raw", "grams": 200},
            {"ingredient_id": "broccoli_raw", "grams": 150},
            {"ingredient_id": "cherry_tomatoes", "grams": 100},
            {"ingredient_id": "olive_oil", "grams": 10},
        ],
        "tags": ["lunch", "dinner"],
    },
    "chicken_rice_bowl": {
        "name": "Chicken Rice Bowl",
        "items": [
            {"ingredient_id": "chicken_breast_raw", "grams": 200},
            {"ingredient_id": "white_rice_raw", "grams": 100},
            {"ingredient_id": "broccoli_raw", "grams": 100},
            {"ingredient_id": "olive_oil", "grams": 10},
        ],
        "tags": ["lunch", "dinner"],
    },
    "salmon_rice_bowl": {
        "name": "Salmon Rice Bowl",
        "items": [
            {"ingredient_id": "salmon_raw", "grams": 180},
            {"ingredient_id": "white_rice_raw", "grams": 100},
            {"ingredient_id": "avocado", "grams": 50},
            {"ingredient_id": "cucumber", "grams": 80},
        ],
        "tags": ["lunch", "dinner"],
    },
    "yogurt_snack_bowl": {
        "name": "Yogurt Snack Bowl",
        "items": [
            {"ingredient_id": "greek_yogurt_2pct", "grams": 200},
            {"ingredient_id": "banana", "grams": 120},
            {"ingredient_id": "purely_elizabeth_granola", "grams": 30},
        ],
        "tags": ["snack"],
    },
    "granola_bowl": {
        "name": "Granola Bowl",
        "items": [
            {"ingredient_id": "purely_elizabeth_granola", "grams": 60},
            {"ingredient_id": "milk_2pct", "grams": 200},
            {"ingredient_id": "banana", "grams": 120},
        ],
        "tags": ["breakfast", "snack"],
    },
    "pre_sleep_cottage": {
        "name": "Pre-Sleep Cottage",
        "items": [
            {"ingredient_id": "cottage_cheese_2pct", "grams": 200},
            {"ingredient_id": "cherry_tomatoes", "grams": 80},
            {"ingredient_id": "cucumber", "grams": 80},
        ],
        "tags": ["snack", "evening"],
    },
    "energy_gel_single": {
        "name": "Energy Gel",
        "items": [
            {"ingredient_id": "energy_gel", "grams": 35},        # 1 gel packet
        ],
        "tags": ["pre-run", "during-run"],
    },
    "sports_drink_bottle": {
        "name": "Sports Drink",
        "items": [
            {"ingredient_id": "sports_drink", "grams": 500},     # 500ml bottle
        ],
        "tags": ["pre-run", "during-run", "post-run"],
    },
}


# ---------------------------------------------------------------------------
# Drink / alcohol database (9 items)
# ---------------------------------------------------------------------------

DRINK_DATABASE = {
    "beer_light": {
        "name": "Light Beer",
        "calories_per_100ml": 29,
        "carbs_per_100ml": 1.3,
        "alcohol_pct": 4.2,
        "default_ml": 355,   # 12 oz can
    },
    "beer_regular": {
        "name": "Regular Beer",
        "calories_per_100ml": 43,
        "carbs_per_100ml": 3.6,
        "alcohol_pct": 5.0,
        "default_ml": 355,
    },
    "beer_ipa": {
        "name": "IPA",
        "calories_per_100ml": 60,
        "carbs_per_100ml": 4.0,
        "alcohol_pct": 6.5,
        "default_ml": 355,
    },
    "beer_craft": {
        "name": "Craft Beer",
        "calories_per_100ml": 65,
        "carbs_per_100ml": 5.0,
        "alcohol_pct": 7.0,
        "default_ml": 355,
    },
    "wine_red": {
        "name": "Red Wine",
        "calories_per_100ml": 85,
        "carbs_per_100ml": 2.6,
        "alcohol_pct": 13.5,
        "default_ml": 150,   # standard pour
    },
    "wine_white": {
        "name": "White Wine",
        "calories_per_100ml": 82,
        "carbs_per_100ml": 2.6,
        "alcohol_pct": 12.5,
        "default_ml": 150,
    },
    "spirit": {
        "name": "Spirit (neat/rocks)",
        "calories_per_100ml": 231,
        "carbs_per_100ml": 0,
        "alcohol_pct": 40.0,
        "default_ml": 45,    # 1.5 oz shot
    },
    "margarita": {
        "name": "Margarita",
        "calories_per_100ml": 110,
        "carbs_per_100ml": 11.0,
        "alcohol_pct": 13.0,
        "default_ml": 240,
    },
    "old_fashioned": {
        "name": "Old Fashioned",
        "calories_per_100ml": 140,
        "carbs_per_100ml": 5.0,
        "alcohol_pct": 20.0,
        "default_ml": 120,
    },
}

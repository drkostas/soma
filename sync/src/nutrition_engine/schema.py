"""Nutrition engine database schema — Task 1.

Defines the 7 nutrition tables and provides apply_schema() to execute the DDL.
"""

NUTRITION_SCHEMA_SQL = """
-- Nutrition Profile (singleton: one row per user)
CREATE TABLE IF NOT EXISTS nutrition_profile (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    weight_kg       REAL,
    height_cm       REAL,
    age             INTEGER,
    sex             VARCHAR(10),
    activity_level  VARCHAR(20),
    goal            VARCHAR(20),
    target_calories INTEGER,
    target_protein  REAL,
    target_carbs    REAL,
    target_fat      REAL,
    target_fiber    REAL,
    estimated_bf_pct REAL,
    target_bf_pct   REAL,
    target_date     DATE,
    tdee_estimate   INTEGER,
    daily_deficit   INTEGER,
    ffm_kg          REAL,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill columns for existing installs
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS estimated_bf_pct REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS target_bf_pct   REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS target_date     DATE;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS tdee_estimate   INTEGER;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS daily_deficit   INTEGER;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS ffm_kg          REAL;

-- Ingredient library
CREATE TABLE IF NOT EXISTS ingredients (
    id                  VARCHAR(60) PRIMARY KEY,
    name                VARCHAR(120) NOT NULL,
    calories_per_100g   REAL NOT NULL,
    protein_per_100g    REAL NOT NULL,
    carbs_per_100g      REAL NOT NULL,
    fat_per_100g        REAL NOT NULL,
    fiber_per_100g      REAL NOT NULL DEFAULT 0,
    is_raw              BOOLEAN NOT NULL DEFAULT FALSE,
    raw_to_cooked_ratio REAL,
    category            VARCHAR(40),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Preset meal templates
CREATE TABLE IF NOT EXISTS preset_meals (
    id          VARCHAR(60) PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    items       JSONB NOT NULL,
    tags        TEXT[],
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Daily nutrition plan / summary
CREATE TABLE IF NOT EXISTS nutrition_day (
    date            DATE PRIMARY KEY,
    plan            JSONB,
    target_calories INTEGER,
    target_protein  REAL,
    target_carbs    REAL,
    target_fat      REAL,
    actual_calories REAL DEFAULT 0,
    actual_protein  REAL DEFAULT 0,
    actual_carbs    REAL DEFAULT 0,
    actual_fat      REAL DEFAULT 0,
    actual_fiber    REAL DEFAULT 0,
    closed          BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Individual meal log entries
CREATE TABLE IF NOT EXISTS meal_log (
    id          SERIAL PRIMARY KEY,
    date        DATE NOT NULL REFERENCES nutrition_day(date),
    meal_label  VARCHAR(40) NOT NULL,
    preset_id   VARCHAR(60),
    items       JSONB NOT NULL,
    calories    REAL NOT NULL,
    protein     REAL NOT NULL,
    carbs       REAL NOT NULL,
    fat         REAL NOT NULL,
    fiber       REAL NOT NULL DEFAULT 0,
    multiplier  REAL NOT NULL DEFAULT 1.0,
    logged_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Drink / alcohol log entries
CREATE TABLE IF NOT EXISTS drink_log (
    id          SERIAL PRIMARY KEY,
    date        DATE NOT NULL REFERENCES nutrition_day(date),
    drink_id    VARCHAR(60) NOT NULL,
    name        VARCHAR(120) NOT NULL,
    quantity_ml REAL NOT NULL,
    calories    REAL NOT NULL,
    carbs       REAL NOT NULL DEFAULT 0,
    alcohol_g   REAL NOT NULL DEFAULT 0,
    logged_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meal_log_date ON meal_log(date);
CREATE INDEX IF NOT EXISTS idx_drink_log_date ON drink_log(date);

-- TDEE history (one row per day, updated by bootstrap / sync)
CREATE TABLE IF NOT EXISTS tdee_history (
    date                DATE PRIMARY KEY,
    bmr                 REAL,
    active_calories     REAL,
    total_calories      REAL,
    garmin_total_kcal   REAL,
    activity_minutes    REAL,
    source              VARCHAR(20),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
"""


def apply_schema(conn):
    """Execute the nutrition schema DDL on the given DB connection."""
    with conn.cursor() as cur:
        cur.execute(NUTRITION_SCHEMA_SQL)
    conn.commit()

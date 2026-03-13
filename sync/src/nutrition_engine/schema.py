"""Nutrition engine database schema — Task 1.

Defines the 7 nutrition tables and provides apply_schema() to execute the DDL.
"""

NUTRITION_SCHEMA_SQL = """
-- Nutrition Profile (singleton: one row per user)
CREATE TABLE IF NOT EXISTS nutrition_profile (
    id                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    weight_kg             REAL,
    height_cm             REAL,
    age                   INTEGER,
    sex                   VARCHAR(10),
    activity_level        VARCHAR(20),
    goal                  VARCHAR(20),
    target_calories       INTEGER,
    target_protein        REAL,
    target_carbs          REAL,
    target_fat            REAL,
    target_fiber          REAL,
    estimated_bf_pct      REAL,
    estimated_ffm_kg      REAL,
    target_bf_pct         REAL,
    target_date           DATE,
    tdee_estimate         REAL,
    tdee_confidence       VARCHAR(20),
    daily_deficit         REAL,
    protein_g_per_kg      REAL DEFAULT 2.2,
    fat_g_per_kg          REAL DEFAULT 0.8,
    step_goal             INTEGER DEFAULT 10000,
    creatine_dose_g       REAL DEFAULT 5.0,
    creatine_start_date   DATE,
    creatine_dose_change_date DATE,
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill columns for existing installs
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS estimated_bf_pct REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS estimated_ffm_kg REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS target_bf_pct   REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS target_date     DATE;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS tdee_estimate   REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS tdee_confidence VARCHAR(20);
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS daily_deficit   REAL;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS protein_g_per_kg REAL DEFAULT 2.2;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS fat_g_per_kg    REAL DEFAULT 0.8;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS step_goal       INTEGER DEFAULT 10000;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS creatine_dose_g REAL DEFAULT 5.0;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS creatine_start_date DATE;
ALTER TABLE nutrition_profile ADD COLUMN IF NOT EXISTS creatine_dose_change_date DATE;

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
    date                DATE PRIMARY KEY,
    plan                JSONB,
    target_calories     INTEGER,
    target_protein      REAL,
    target_carbs        REAL,
    target_fat          REAL,
    target_fiber        REAL,
    tdee_used           REAL,
    exercise_calories   REAL,
    step_calories       REAL,
    deficit_used        REAL,
    adjustment_reason   TEXT,
    sleep_quality_score REAL,
    training_day_type   VARCHAR(20),
    planned_workouts    JSONB,
    step_goal           INTEGER,
    is_refeed           BOOLEAN DEFAULT FALSE,
    is_diet_break       BOOLEAN DEFAULT FALSE,
    status              VARCHAR(20) DEFAULT 'active',
    actual_calories     REAL DEFAULT 0,
    actual_protein      REAL DEFAULT 0,
    actual_carbs        REAL DEFAULT 0,
    actual_fat          REAL DEFAULT 0,
    actual_fiber        REAL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill columns for existing installs
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS target_fiber        REAL;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS tdee_used           REAL;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS exercise_calories   REAL;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS step_calories       REAL;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS deficit_used        REAL;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS adjustment_reason   TEXT;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS sleep_quality_score REAL;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS training_day_type   VARCHAR(20);
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS planned_workouts    JSONB;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS step_goal           INTEGER;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS is_refeed           BOOLEAN DEFAULT FALSE;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS is_diet_break       BOOLEAN DEFAULT FALSE;
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS status              VARCHAR(20) DEFAULT 'active';

-- Migrate closed → status
UPDATE nutrition_day SET status = 'closed' WHERE closed = TRUE;
ALTER TABLE nutrition_day DROP COLUMN IF EXISTS closed;

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

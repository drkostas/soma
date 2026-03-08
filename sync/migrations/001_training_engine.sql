-- ============================================
-- MIGRATION 001: Training Engine Tables
-- Adds training load, readiness, PMC, fitness
-- trajectory, and training plan tables
-- ============================================

-- ===================
-- TRAINING LOAD (PMC input)
-- ===================

CREATE TABLE IF NOT EXISTS training_load (
    id                  BIGSERIAL PRIMARY KEY,
    activity_date       DATE NOT NULL,
    activity_id         BIGINT,
    hevy_id             VARCHAR(100),
    source              VARCHAR(20) NOT NULL,
    load_metric         VARCHAR(20) NOT NULL,
    load_value          FLOAT NOT NULL,
    duration_seconds    INT,
    details             JSONB,
    computed_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Handle NULL-safe uniqueness: activity_id and hevy_id can both be NULL
-- Use partial unique indexes to cover all cases
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_load_activity
    ON training_load(activity_id, load_metric)
    WHERE activity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_training_load_hevy
    ON training_load(hevy_id, load_metric)
    WHERE hevy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_load_date ON training_load(activity_date);
CREATE INDEX IF NOT EXISTS idx_training_load_activity ON training_load(activity_id);

-- ===================
-- DAILY READINESS
-- ===================

CREATE TABLE IF NOT EXISTS daily_readiness (
    date                    DATE PRIMARY KEY,
    hrv_z_score             FLOAT,
    sleep_z_score           FLOAT,
    rhr_z_score             FLOAT,
    body_battery_z_score    FLOAT,
    composite_score         FLOAT,
    traffic_light           VARCHAR(10),
    flags                   JSONB,
    weight_method           VARCHAR(20) DEFAULT 'equal',
    computed_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ===================
-- PMC DAILY (CTL/ATL/TSB)
-- ===================

CREATE TABLE IF NOT EXISTS pmc_daily (
    date            DATE PRIMARY KEY,
    ctl             FLOAT NOT NULL,
    atl             FLOAT NOT NULL,
    tsb             FLOAT NOT NULL,
    daily_load      FLOAT NOT NULL DEFAULT 0,
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmc_date ON pmc_daily(date);

-- ===================
-- FITNESS TRAJECTORY
-- ===================

CREATE TABLE IF NOT EXISTS fitness_trajectory (
    date                    DATE PRIMARY KEY,
    vo2max                  FLOAT,
    efficiency_factor       FLOAT,
    decoupling_pct          FLOAT,
    weight_kg               FLOAT,
    vdot_adjusted           FLOAT,
    race_prediction_seconds INT,
    computed_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ===================
-- TRAINING PLAN
-- ===================

CREATE TABLE IF NOT EXISTS training_plan (
    id                  SERIAL PRIMARY KEY,
    plan_name           VARCHAR(100) NOT NULL,
    race_date           DATE NOT NULL,
    race_distance_km    FLOAT NOT NULL,
    goal_time_seconds   INT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    status              VARCHAR(20) DEFAULT 'active'
);

-- ===================
-- TRAINING PLAN DAY
-- ===================

CREATE TABLE IF NOT EXISTS training_plan_day (
    id                  SERIAL PRIMARY KEY,
    plan_id             INT NOT NULL REFERENCES training_plan(id),
    day_date            DATE NOT NULL,
    week_number         INT NOT NULL,
    day_of_week         INT NOT NULL,
    run_type            VARCHAR(30),
    run_title           VARCHAR(200),
    run_description     TEXT,
    target_distance_km  FLOAT,
    target_duration_min FLOAT,
    workout_steps       JSONB,
    gym_workout         VARCHAR(20),
    gym_notes           TEXT,
    load_level          VARCHAR(20),
    completed           BOOLEAN DEFAULT FALSE,
    actual_distance_km  FLOAT,
    actual_duration_min FLOAT,
    garmin_workout_id   TEXT,
    garmin_push_status  VARCHAR(20) DEFAULT 'none',
    UNIQUE(plan_id, day_date)
);

CREATE INDEX IF NOT EXISTS idx_plan_day_date ON training_plan_day(day_date);
CREATE INDEX IF NOT EXISTS idx_plan_day_plan ON training_plan_day(plan_id);

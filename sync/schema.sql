-- ============================================
-- SOMA DATABASE SCHEMA
-- Layer 1: Raw Data Lake
-- Layer 2: Structured Views
-- Layer 3: Computed Analytics (Phase 1 subset)
-- ============================================

-- ===================
-- LAYER 1: RAW DATA
-- ===================

CREATE TABLE IF NOT EXISTS garmin_raw_data (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE NOT NULL,
    endpoint_name   VARCHAR(100) NOT NULL,
    raw_json        JSONB NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date, endpoint_name)
);

CREATE INDEX IF NOT EXISTS idx_garmin_raw_date ON garmin_raw_data(date);
CREATE INDEX IF NOT EXISTS idx_garmin_raw_endpoint ON garmin_raw_data(endpoint_name);

-- ===================
-- LAYER 2: STRUCTURED
-- ===================

CREATE TABLE IF NOT EXISTS daily_health_summary (
    date                        DATE PRIMARY KEY,
    total_steps                 INTEGER,
    total_distance_meters       REAL,
    floors_climbed              INTEGER,
    active_time_seconds         INTEGER,
    sedentary_time_seconds      INTEGER,
    moderate_intensity_minutes  INTEGER,
    vigorous_intensity_minutes  INTEGER,
    total_kilocalories          INTEGER,
    active_kilocalories         INTEGER,
    bmr_kilocalories            INTEGER,
    resting_heart_rate          INTEGER,
    min_heart_rate              INTEGER,
    max_heart_rate              INTEGER,
    avg_stress_level            INTEGER,
    max_stress_level            INTEGER,
    body_battery_charged        INTEGER,
    body_battery_drained        INTEGER,
    body_battery_max            INTEGER,
    body_battery_min            INTEGER,
    sleep_time_seconds          INTEGER,
    hrv_weekly_avg              INTEGER,
    hrv_last_night_avg          INTEGER,
    hrv_status                  VARCHAR(20),
    spo2_avg                    REAL,
    synced_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weight_log (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE NOT NULL,
    weight_grams    REAL NOT NULL,
    bmi             REAL,
    body_fat_pct    REAL,
    body_water_pct  REAL,
    bone_mass_grams REAL,
    muscle_mass_grams REAL,
    source_type     VARCHAR(20),
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date, weight_grams)
);

CREATE INDEX IF NOT EXISTS idx_weight_date ON weight_log(date);

CREATE TABLE IF NOT EXISTS sleep_detail (
    date                    DATE PRIMARY KEY,
    sleep_start             TIMESTAMPTZ,
    sleep_end               TIMESTAMPTZ,
    total_sleep_seconds     INTEGER,
    deep_sleep_seconds      INTEGER,
    light_sleep_seconds     INTEGER,
    rem_sleep_seconds       INTEGER,
    awake_seconds           INTEGER,
    sleep_score             INTEGER,
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================
-- LAYER 3: ANALYTICS
-- ===================

CREATE TABLE IF NOT EXISTS analytics_weight_trend (
    date            DATE PRIMARY KEY,
    weight_kg       REAL NOT NULL,
    avg_7d          REAL,
    avg_30d         REAL,
    delta_7d        REAL,
    delta_30d       REAL,
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================
-- SYNC METADATA
-- ===================

CREATE TABLE IF NOT EXISTS sync_log (
    id              BIGSERIAL PRIMARY KEY,
    sync_type       VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL,
    records_synced  INTEGER DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- ===================
-- LAYER 1: RAW DATA (Hevy)
-- ===================

CREATE TABLE IF NOT EXISTS hevy_raw_data (
    id              BIGSERIAL PRIMARY KEY,
    hevy_id         VARCHAR(100),
    endpoint_name   VARCHAR(100) NOT NULL,
    raw_json        JSONB NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(hevy_id, endpoint_name)
);

CREATE INDEX IF NOT EXISTS idx_hevy_raw_endpoint ON hevy_raw_data(endpoint_name);
CREATE INDEX IF NOT EXISTS idx_hevy_raw_hevy_id ON hevy_raw_data(hevy_id);

-- ===================
-- LAYER 1: RAW DATA (Garmin Activities)
-- ===================

CREATE TABLE IF NOT EXISTS garmin_activity_raw (
    id              BIGSERIAL PRIMARY KEY,
    activity_id     BIGINT NOT NULL,
    endpoint_name   VARCHAR(100) NOT NULL,
    raw_json        JSONB NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(activity_id, endpoint_name)
);

CREATE INDEX IF NOT EXISTS idx_garmin_activity_id ON garmin_activity_raw(activity_id);

-- ===================
-- LAYER 1: RAW DATA (Garmin Profile — one-time)
-- ===================

CREATE TABLE IF NOT EXISTS garmin_profile_raw (
    id              BIGSERIAL PRIMARY KEY,
    endpoint_name   VARCHAR(100) NOT NULL UNIQUE,
    raw_json        JSONB NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================
-- LAYER 2: WORKOUT ENRICHMENT
-- ===================

CREATE TABLE IF NOT EXISTS workout_enrichment (
    id                  BIGSERIAL PRIMARY KEY,
    hevy_id             VARCHAR(100) NOT NULL UNIQUE,
    garmin_activity_id  BIGINT,

    -- HR data
    hr_source           VARCHAR(20) NOT NULL,
    avg_hr              INTEGER,
    max_hr              INTEGER,
    min_hr              INTEGER,
    hr_samples          JSONB,
    hr_sample_count     INTEGER,

    -- Calories
    calories            INTEGER,

    -- Workout timing
    duration_s          FLOAT,
    exercise_count      INTEGER,
    total_sets          INTEGER,

    -- Metadata
    hevy_title          VARCHAR(500),
    workout_date        DATE,
    status              VARCHAR(20) NOT NULL DEFAULT 'enriched',
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_date ON workout_enrichment(workout_date);
CREATE INDEX IF NOT EXISTS idx_enrichment_garmin ON workout_enrichment(garmin_activity_id);

-- ===================
-- BACKFILL TRACKING
-- ===================

CREATE TABLE IF NOT EXISTS backfill_progress (
    source              VARCHAR(50) PRIMARY KEY,
    oldest_date_done    DATE,
    last_page           INTEGER DEFAULT 0,
    total_items         INTEGER DEFAULT 0,
    items_completed     INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'pending',
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ===================
-- PLATFORM CREDENTIALS
-- ===================

CREATE TABLE IF NOT EXISTS platform_credentials (
    platform        VARCHAR(50) PRIMARY KEY,
    auth_type       VARCHAR(20) NOT NULL,
    credentials     JSONB NOT NULL DEFAULT '{}',
    connected_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    status          VARCHAR(20) DEFAULT 'disconnected'
);

-- ===================
-- SYNC RULES
-- ===================

CREATE TABLE IF NOT EXISTS sync_rules (
    id              SERIAL PRIMARY KEY,
    source_platform VARCHAR(50) NOT NULL,
    activity_type   VARCHAR(50) DEFAULT '*',
    preprocessing   TEXT[] DEFAULT '{}',
    destinations    JSONB NOT NULL,
    enabled         BOOLEAN DEFAULT true,
    priority        INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===================
-- ACTIVITY SYNC LOG
-- ===================

CREATE TABLE IF NOT EXISTS activity_sync_log (
    id              BIGSERIAL PRIMARY KEY,
    source_platform VARCHAR(50) NOT NULL,
    source_id       VARCHAR(200) NOT NULL,
    destination     VARCHAR(50) NOT NULL,
    destination_id  VARCHAR(200),
    rule_id         INTEGER REFERENCES sync_rules(id),
    status          VARCHAR(20) NOT NULL,
    error_message   TEXT,
    processed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_source ON activity_sync_log(source_platform, source_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_dest ON activity_sync_log(destination, destination_id);

-- ===================
-- PUSH NOTIFICATIONS
-- ===================

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              SERIAL PRIMARY KEY,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id                  SERIAL PRIMARY KEY,
    enabled             BOOLEAN DEFAULT true,
    on_sync_workout     BOOLEAN DEFAULT true,
    on_sync_run         BOOLEAN DEFAULT true,
    on_sync_error       BOOLEAN DEFAULT true,
    on_milestone        BOOLEAN DEFAULT true,
    on_playlist_ready   BOOLEAN DEFAULT false,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO notification_preferences (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ===================
-- LAYER 1: RAW DATA (Strava)
-- ===================

CREATE TABLE IF NOT EXISTS strava_raw_data (
    id              BIGSERIAL PRIMARY KEY,
    strava_id       BIGINT NOT NULL,
    endpoint_name   VARCHAR(100) NOT NULL,
    raw_json        JSONB NOT NULL,
    synced_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(strava_id, endpoint_name)
);

CREATE INDEX IF NOT EXISTS idx_strava_raw_id ON strava_raw_data(strava_id);
CREATE INDEX IF NOT EXISTS idx_strava_raw_endpoint ON strava_raw_data(endpoint_name);

-- ===================
-- PLAYLIST / WORKOUT BUILDER
-- ===================

CREATE TABLE IF NOT EXISTS garmin_workouts (
    workout_id      TEXT PRIMARY KEY,
    workout_name    TEXT NOT NULL,
    sport_type      TEXT DEFAULT 'running',
    steps_summary   TEXT,
    segments        JSONB,
    raw_json        JSONB NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- workout_plans: garmin_workout_id and garmin_push_status added post-launch
ALTER TABLE workout_plans
    ADD COLUMN IF NOT EXISTS garmin_workout_id TEXT,
    ADD COLUMN IF NOT EXISTS garmin_push_status TEXT DEFAULT 'none';

-- ============================================
-- TRAINING ENGINE TABLES
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

-- ===================
-- HIGH-VALUE FIELDS ON daily_health_summary
-- ===================

ALTER TABLE daily_health_summary
    ADD COLUMN IF NOT EXISTS body_battery_at_wake INT,
    ADD COLUMN IF NOT EXISTS avg_overnight_hrv FLOAT,
    ADD COLUMN IF NOT EXISTS hrv_baseline FLOAT,
    ADD COLUMN IF NOT EXISTS rhr_7day_avg FLOAT,
    ADD COLUMN IF NOT EXISTS avg_sleep_stress FLOAT,
    ADD COLUMN IF NOT EXISTS training_readiness_score INT,
    ADD COLUMN IF NOT EXISTS training_readiness_level VARCHAR(20);


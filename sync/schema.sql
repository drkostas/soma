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

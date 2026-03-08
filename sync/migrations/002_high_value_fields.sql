-- ============================================
-- MIGRATION 002: High-Value Fields on daily_health_summary
-- Adds derived biometric columns used by readiness scoring
-- ============================================

ALTER TABLE daily_health_summary
    ADD COLUMN IF NOT EXISTS body_battery_at_wake INT,
    ADD COLUMN IF NOT EXISTS avg_overnight_hrv FLOAT,
    ADD COLUMN IF NOT EXISTS hrv_baseline FLOAT,
    ADD COLUMN IF NOT EXISTS rhr_7day_avg FLOAT,
    ADD COLUMN IF NOT EXISTS avg_sleep_stress FLOAT,
    ADD COLUMN IF NOT EXISTS training_readiness_score INT,
    ADD COLUMN IF NOT EXISTS training_readiness_level VARCHAR(20);

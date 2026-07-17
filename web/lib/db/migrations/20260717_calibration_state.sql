-- Migration: 20260717_calibration_state
-- Description: Readiness calibration state for the training engine. Read by
--   app/api/training/graph + forward-sim (they degrade to equal weights if the
--   row is absent) and written by app/api/training/calibration/toggle.
-- Apply: psql "$DATABASE_URL" -f web/lib/db/migrations/20260717_calibration_state.sql

CREATE TABLE IF NOT EXISTS calibration_state (
  id          SERIAL PRIMARY KEY,
  phase       INT DEFAULT 1,
  data_days   INT DEFAULT 0,
  weights     JSONB,
  correlations JSONB,
  force_equal BOOLEAN DEFAULT FALSE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the singleton row the toggle updates (WHERE id = 1) with equal-weight
-- defaults, so a fresh DB behaves identically to the graceful fallback.
INSERT INTO calibration_state (id, phase, data_days, weights, correlations, force_equal)
VALUES (1, 1, 0, '{"hrv":0.25,"sleep":0.25,"rhr":0.25,"bb":0.25}', '{}', FALSE)
ON CONFLICT (id) DO NOTHING;

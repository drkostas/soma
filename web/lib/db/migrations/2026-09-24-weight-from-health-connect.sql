-- Weight arrives from Health Connect on the phone, and has to go out to Garmin and Strava.
--
-- ⛔ A BACKGROUND TASK RE-READS THE SAME RECORDS, so the write has to be idempotent on the
-- SOURCE's own identity. `UNIQUE (date, weight_grams)` already existed and nearly does it, but it
-- loses a second genuine weigh-in at the same weight on the same day, and it cannot tell a re-read
-- from a new reading. Health Connect gives every record a stable uuid; that is the real key.
ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_external_id
  ON weight_log (external_id) WHERE external_id IS NOT NULL;

-- Pushing outwards is the sync job's work, not the request's: a Garmin outage must not lose a
-- reading he already took, so the row lands first and the push is retried until it sticks.
ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS pushed_garmin_at timestamptz;
ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS pushed_strava_at timestamptz;

-- What the scale measured beyond the weight, when it says so. Arboleaf sends body fat.
ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS measured_at timestamptz;

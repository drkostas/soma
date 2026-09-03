-- T3a ingredient research (soma#678). Additive only; applied by hand to Neon on 2026-09-03.
-- Every existing ingredient is backfilled to status='confirmed' by the DEFAULT, so the
-- `WHERE status = 'confirmed'` gate on the readers is a no-op for today's rows.
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS status         VARCHAR(16)  NOT NULL DEFAULT 'confirmed',  -- confirmed | tombstoned
  ADD COLUMN IF NOT EXISTS source         VARCHAR(24),                                -- usda | off | manual
  ADD COLUMN IF NOT EXISTS source_id      TEXT,                                       -- FDC id as text / OFF barcode
  ADD COLUMN IF NOT EXISTS source_url     TEXT,
  ADD COLUMN IF NOT EXISTS confidence     REAL,                                       -- 0..1, from the research step
  ADD COLUMN IF NOT EXISTS research_notes TEXT,
  ADD COLUMN IF NOT EXISTS researched_at  TIMESTAMPTZ;

-- Candidates never touch `ingredients` until the owner confirms one.
CREATE TABLE IF NOT EXISTS ingredient_proposals (
  id                      SERIAL PRIMARY KEY,
  query                   TEXT NOT NULL,
  name                    TEXT NOT NULL,
  calories_per_100g       REAL,            -- NULL = unknown (never 0 for unknown)
  protein_per_100g        REAL,
  carbs_per_100g          REAL,
  fat_per_100g            REAL,
  fiber_per_100g          REAL,
  category                VARCHAR(40),
  unit                    VARCHAR(20) DEFAULT 'g',
  grams_per_unit          REAL,
  is_raw                  BOOLEAN,
  raw_to_cooked_ratio     REAL,
  source                  VARCHAR(24) NOT NULL,   -- usda | off
  source_id               TEXT,
  source_url              TEXT,
  confidence              REAL,
  rationale               TEXT,
  flags                   TEXT[] NOT NULL DEFAULT '{}',  -- kcal_macro_mismatch, missing:<macro>
  status                  VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | confirmed | rejected
  confirmed_ingredient_id VARCHAR(60),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingredient_proposals_query ON ingredient_proposals (query, created_at DESC);

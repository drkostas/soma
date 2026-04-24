-- Nutrition Batch 2: add deficit_mode column for the M2 mode engine.
-- Default 'standard' preserves current behaviour for existing rows.

ALTER TABLE nutrition_profile
    ADD COLUMN IF NOT EXISTS deficit_mode text NOT NULL DEFAULT 'standard';

-- CHECK constraint matches macro-engine's Mode enum.
ALTER TABLE nutrition_profile
    DROP CONSTRAINT IF EXISTS nutrition_profile_deficit_mode_check;

ALTER TABLE nutrition_profile
    ADD CONSTRAINT nutrition_profile_deficit_mode_check
    CHECK (deficit_mode IN (
        'standard', 'aggressive', 'reverse', 'maintenance', 'bulk', 'injured'
    ));

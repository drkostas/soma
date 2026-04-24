-- Nutrition Batch 3: add deficit_phase_start_date column for the M5.3
-- diet-break recommender + M1.7 deficit duration counter.
--
-- Null means "not currently in an explicit deficit phase" (the counter
-- returns 0). Set to the date the user began a new cut to start the clock.

ALTER TABLE nutrition_profile
    ADD COLUMN IF NOT EXISTS deficit_phase_start_date date;

-- The zone the capture was made in, so the drain can reason in his clock and not the Mac's.
--
-- The route knows the device's zone because the device sends it, but the worker runs minutes later
-- on another machine, which is the same gap as the photo: what has to cross it goes in the row.
-- Null means the capture predates this, and the fallback applies.
ALTER TABLE meal_capture ADD COLUMN IF NOT EXISTS tz varchar(64);

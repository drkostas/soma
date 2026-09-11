-- Who closed the day (soma#893). Additive; applied by hand to verify_soma first, then to soma.
-- A day is observed only when a person closed it or every slot was logged (soma#891). The old
-- auto-close left closed rows with no meal_log rows and no skipped slots; those are 'auto'.
ALTER TABLE nutrition_day ADD COLUMN IF NOT EXISTS closed_by TEXT CHECK (closed_by IN ('user', 'auto'));
UPDATE nutrition_day d SET closed_by = CASE
  WHEN NOT EXISTS (SELECT 1 FROM meal_log m WHERE m.date = d.date)
   AND COALESCE(array_length(d.skipped_slots, 1), 0) = 0 THEN 'auto'
  ELSE 'user' END
WHERE status = 'closed' AND closed_by IS NULL;

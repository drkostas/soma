-- Fix garmin -> telegram routing rules
-- Rule 6 & 7 are duplicate disabled rules for garmin/running/telegram
-- Enable rule 6 with wildcard activity_type (covers running, trail_running, etc.)
-- Disable rule 7 (can't delete due to FK references in activity_sync_log)

UPDATE sync_rules SET enabled = true, activity_type = '*' WHERE id = 6;
UPDATE sync_rules SET enabled = false WHERE id = 7;

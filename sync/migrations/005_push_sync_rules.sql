-- Add push notification routing rules (mirrors telegram rules)

-- garmin -> push (all activity types)
INSERT INTO sync_rules (source_platform, activity_type, destinations, enabled, priority)
VALUES ('garmin', '*', '{"push": {"enabled": true}}'::jsonb, true, 0);

-- hevy -> push (strength workouts)
INSERT INTO sync_rules (source_platform, activity_type, destinations, enabled, priority)
VALUES ('hevy', 'strength', '{"push": {"enabled": true}}'::jsonb, true, 0);

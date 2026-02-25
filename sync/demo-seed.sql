-- =============================================================================
-- Soma Demo Seed Data
-- Realistic synthetic health data for the public demo instance.
-- Run against your demo Neon database after applying schema.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- garmin_daily — 2 years of daily health metrics
-- Steps ~9k avg, resting HR ~55bpm, sleep ~7.5h, body battery, stress, VO2max
-- -----------------------------------------------------------------------------
INSERT INTO garmin_daily (date, raw_json)
SELECT
  (CURRENT_DATE - s.i)::date AS date,
  jsonb_build_object(
    'totalSteps',          (7000 + (random() * 8000)::int + CASE WHEN extract(dow FROM (CURRENT_DATE - s.i)) IN (0,6) THEN 2000 ELSE 0 END),
    'restingHeartRate',    (50 + (random() * 12)::int),
    'averageStressLevel',  (15 + (random() * 30)::int),
    'bodyBatteryChargedValue', (60 + (random() * 35)::int),
    'bodyBatteryDrainedValue', (40 + (random() * 50)::int),
    'sleepingSeconds',     ((6.5 + random() * 2.5) * 3600)::int,
    'activeKilocalories',  (300 + (random() * 700)::int),
    'bmrKilocalories',     (1700 + (random() * 200)::int),
    'floorsAscended',      (3 + (random() * 15)::int),
    'vo2MaxValue',         (50 + (random() * 8 - 4 + (s.i::float / 730) * 3))::numeric(4,1),
    'averageSpo2',         (95 + (random() * 4))::numeric(4,1),
    'averageRespirationValue', (13 + random() * 4)::numeric(4,1),
    'hrvWeeklyAverage',    (55 + (random() * 30)::int),
    'highStressSeconds',   ((random() * 3600)::int),
    'lowStressSeconds',    ((1800 + random() * 5400)::int),
    'totalDistanceMeters', (3000 + (random() * 5000)::int)
  )
FROM generate_series(0, 729) AS s(i)
ON CONFLICT (date) DO NOTHING;

-- -----------------------------------------------------------------------------
-- garmin_raw_data — sleep detail + training status (one row per day)
-- -----------------------------------------------------------------------------
INSERT INTO garmin_raw_data (date, endpoint_name, raw_json)
SELECT
  (CURRENT_DATE - s.i)::date AS date,
  'sleep_detail',
  jsonb_build_object(
    'sleepStartTimestampLocal', extract(epoch FROM (CURRENT_DATE - s.i - interval '1 day')::timestamp + interval '22 hours' + (random() * 3600 || ' seconds')::interval)::bigint * 1000,
    'sleepEndTimestampLocal',   extract(epoch FROM (CURRENT_DATE - s.i)::timestamp + interval '6 hours' + (random() * 3600 || ' seconds')::interval)::bigint * 1000,
    'deepSleepSeconds',  ((50 + random() * 60) * 60)::int,
    'lightSleepSeconds', ((180 + random() * 90) * 60)::int,
    'remSleepSeconds',   ((60 + random() * 60) * 60)::int,
    'awakeSleepSeconds', ((5 + random() * 20) * 60)::int,
    'averageSpO2Value',  (95 + random() * 4)::numeric(4,1),
    'averageRespirationValue', (13 + random() * 4)::numeric(4,1),
    'averageHRV',        (55 + (random() * 30)::int),
    'overallSleepScore', jsonb_build_object('value', (65 + (random() * 30)::int))
  )
FROM generate_series(0, 729) AS s(i)
ON CONFLICT (date, endpoint_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- garmin_activity_raw — running activities (summary + hr_zones)
-- ~100 runs over 2 years, realistic pace/distance distribution
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  run_date date;
  activity_id bigint;
  distance_m float;
  duration_s float;
  pace_min float;
  avg_hr int;
  run_count int := 0;
  i int;
BEGIN
  FOR i IN 0..99 LOOP
    run_date := CURRENT_DATE - (i * 7 + floor(random() * 5))::int;
    distance_m := (4000 + random() * 12000)::float;  -- 4-16km
    pace_min   := (4.8 + random() * 2.0);             -- 4:48 to 6:48 /km
    duration_s := distance_m / 1000.0 * pace_min * 60;
    avg_hr     := (135 + (random() * 25))::int;
    activity_id := 1000000 + i;

    INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json)
    VALUES (
      activity_id,
      'summary',
      jsonb_build_object(
        'activityId',     activity_id,
        'activityName',   CASE (floor(random() * 4))::int
                            WHEN 0 THEN 'Morning Run'
                            WHEN 1 THEN 'Easy Run'
                            WHEN 2 THEN 'Tempo Run'
                            ELSE 'Long Run'
                          END,
        'startTimeLocal', to_char(run_date, 'YYYY-MM-DD') || ' 07:' || lpad((floor(random()*59))::text, 2, '0') || ':00',
        'startTimeGMT',   to_char(run_date, 'YYYY-MM-DD') || ' 12:' || lpad((floor(random()*59))::text, 2, '0') || ':00',
        'beginTimestamp', (extract(epoch FROM run_date::timestamp + interval '7 hours') * 1000)::bigint,
        'distance',       distance_m,
        'duration',       duration_s,
        'averageHR',      avg_hr,
        'maxHR',          (avg_hr + 15 + (random() * 10)::int),
        'calories',       (duration_s / 60 * 10 + random() * 50)::int,
        'averageRunningCadenceInStepsPerMinute', (160 + (random() * 15))::int,
        'elevationGain',  (20 + random() * 150)::float,
        'avgStrideLength', (1.1 + random() * 0.3)::float,
        'vO2MaxValue',    (50 + random() * 8)::float,
        'aerobicTrainingEffect', (2.5 + random() * 2)::float,
        'activityType',   jsonb_build_object('typeKey', 'running')
      )
    ) ON CONFLICT DO NOTHING;

    -- HR zones for each run
    INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json)
    VALUES (
      activity_id,
      'hr_zones',
      jsonb_build_array(
        jsonb_build_object('zoneNumber', 1, 'secsInZone', (duration_s * 0.05)::int, 'zoneLowBoundary', 0,   'zoneHighBoundary', 115),
        jsonb_build_object('zoneNumber', 2, 'secsInZone', (duration_s * 0.35)::int, 'zoneLowBoundary', 115, 'zoneHighBoundary', 135),
        jsonb_build_object('zoneNumber', 3, 'secsInZone', (duration_s * 0.40)::int, 'zoneLowBoundary', 135, 'zoneHighBoundary', 155),
        jsonb_build_object('zoneNumber', 4, 'secsInZone', (duration_s * 0.15)::int, 'zoneLowBoundary', 155, 'zoneHighBoundary', 175),
        jsonb_build_object('zoneNumber', 5, 'secsInZone', (duration_s * 0.05)::int, 'zoneLowBoundary', 175, 'zoneHighBoundary', 220)
      )
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- A handful of non-running Garmin activities (cycling, hiking, etc.)
DO $$
DECLARE
  i int;
  act_id bigint;
  act_type text;
  act_date date;
BEGIN
  FOR i IN 0..29 LOOP
    act_id   := 2000000 + i;
    act_type := CASE (floor(random() * 5))::int
                  WHEN 0 THEN 'cycling'
                  WHEN 1 THEN 'hiking'
                  WHEN 2 THEN 'swimming'
                  WHEN 3 THEN 'strength_training'
                  ELSE 'walking'
                END;
    act_date := CURRENT_DATE - (i * 8 + floor(random() * 6))::int;

    INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json)
    VALUES (
      act_id,
      'summary',
      jsonb_build_object(
        'activityId',    act_id,
        'activityName',  initcap(replace(act_type, '_', ' ')),
        'startTimeLocal', to_char(act_date, 'YYYY-MM-DD') || ' 09:00:00',
        'startTimeGMT',   to_char(act_date, 'YYYY-MM-DD') || ' 14:00:00',
        'beginTimestamp', (extract(epoch FROM act_date::timestamp + interval '9 hours') * 1000)::bigint,
        'distance',      (3000 + random() * 20000)::float,
        'duration',      (1800 + random() * 5400)::float,
        'averageHR',     (120 + (random() * 40)::int),
        'calories',      (200 + (random() * 500)::int),
        'activityType',  jsonb_build_object('typeKey', act_type)
      )
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- hevy_raw_data — 60 gym sessions (Push / Pull / Legs split)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  i int;
  workout_id text;
  workout_date date;
  workout_title text;
  exercises jsonb;
BEGIN
  FOR i IN 0..59 LOOP
    workout_id    := 'demo-workout-' || i;
    workout_date  := CURRENT_DATE - (i * 5 + floor(random() * 3))::int;
    workout_title := CASE (i % 3)
                       WHEN 0 THEN 'Push'
                       WHEN 1 THEN 'Pull'
                       ELSE 'Legs'
                     END;

    exercises := CASE (i % 3)
      WHEN 0 THEN jsonb_build_array(
        jsonb_build_object('title', 'Bench Press', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 80 + (random()*10)::int, 'reps', 5),
          jsonb_build_object('weight_kg', 80 + (random()*10)::int, 'reps', 5),
          jsonb_build_object('weight_kg', 82 + (random()*8)::int,  'reps', 4)
        )),
        jsonb_build_object('title', 'Overhead Press', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 55 + (random()*8)::int, 'reps', 6),
          jsonb_build_object('weight_kg', 55 + (random()*8)::int, 'reps', 6)
        )),
        jsonb_build_object('title', 'Tricep Pushdown', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 30 + (random()*10)::int, 'reps', 12),
          jsonb_build_object('weight_kg', 30 + (random()*10)::int, 'reps', 10)
        ))
      )
      WHEN 1 THEN jsonb_build_array(
        jsonb_build_object('title', 'Deadlift', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 120 + (random()*20)::int, 'reps', 4),
          jsonb_build_object('weight_kg', 120 + (random()*20)::int, 'reps', 4),
          jsonb_build_object('weight_kg', 125 + (random()*15)::int, 'reps', 3)
        )),
        jsonb_build_object('title', 'Pull-Up', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 0, 'reps', 10),
          jsonb_build_object('weight_kg', 0, 'reps', 8),
          jsonb_build_object('weight_kg', 0, 'reps', 7)
        )),
        jsonb_build_object('title', 'Barbell Row', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 70 + (random()*15)::int, 'reps', 8),
          jsonb_build_object('weight_kg', 70 + (random()*15)::int, 'reps', 8)
        ))
      )
      ELSE jsonb_build_array(
        jsonb_build_object('title', 'Squat', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 100 + (random()*20)::int, 'reps', 5),
          jsonb_build_object('weight_kg', 100 + (random()*20)::int, 'reps', 5),
          jsonb_build_object('weight_kg', 102 + (random()*18)::int, 'reps', 4)
        )),
        jsonb_build_object('title', 'Leg Press', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 150 + (random()*30)::int, 'reps', 12),
          jsonb_build_object('weight_kg', 150 + (random()*30)::int, 'reps', 10)
        )),
        jsonb_build_object('title', 'Romanian Deadlift', 'sets', jsonb_build_array(
          jsonb_build_object('weight_kg', 80 + (random()*15)::int, 'reps', 10),
          jsonb_build_object('weight_kg', 80 + (random()*15)::int, 'reps', 10)
        ))
      )
    END;

    INSERT INTO hevy_raw_data (endpoint_name, raw_json)
    VALUES (
      'workout',
      jsonb_build_object(
        'id',          workout_id,
        'title',       workout_title,
        'start_time',  to_char(workout_date, 'YYYY-MM-DD') || 'T17:00:00+00:00',
        'end_time',    to_char(workout_date, 'YYYY-MM-DD') || 'T18:' || lpad((15 + (random()*45)::int)::text, 2, '0') || ':00+00:00',
        'exercises',   exercises
      )
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

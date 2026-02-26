-- =============================================================================
-- Soma Demo Seed Data
-- Realistic synthetic health data for the public demo instance.
-- Run against your demo Neon database after applying schema.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- daily_health_summary — 2 years of daily health metrics
-- Steps ~9k avg, resting HR ~55bpm, sleep ~7.5h, body battery, stress, VO2max
-- -----------------------------------------------------------------------------
INSERT INTO daily_health_summary (
  date, total_steps, total_distance_meters, active_kilocalories, bmr_kilocalories,
  resting_heart_rate, avg_stress_level, max_stress_level,
  body_battery_charged, body_battery_drained,
  sleep_time_seconds, hrv_weekly_avg, hrv_last_night_avg, hrv_status,
  spo2_avg, floors_climbed
)
SELECT
  (CURRENT_DATE - s.i)::date,
  (7000 + (random() * 8000)::int + CASE WHEN extract(dow FROM (CURRENT_DATE - s.i)) IN (0,6) THEN 2000 ELSE 0 END),
  (3000 + (random() * 5000)::int),
  (300 + (random() * 700)::int),
  (1700 + (random() * 200)::int),
  (50 + (random() * 12)::int),
  (15 + (random() * 30)::int),
  (40 + (random() * 45)::int),
  (60 + (random() * 35)::int),
  (40 + (random() * 50)::int),
  ((6.5 + random() * 2.5) * 3600)::int,
  (55 + (random() * 30)::int),
  (50 + (random() * 35)::int),
  CASE WHEN random() > 0.6 THEN 'BALANCED' WHEN random() > 0.3 THEN 'UNBALANCED' ELSE 'LOW' END,
  (95 + (random() * 4))::numeric(4,1),
  (3 + (random() * 15)::int)
FROM generate_series(0, 729) AS s(i)
ON CONFLICT (date) DO NOTHING;

-- -----------------------------------------------------------------------------
-- garmin_raw_data — sleep_data (page expects dailySleepDTO structure)
-- -----------------------------------------------------------------------------
INSERT INTO garmin_raw_data (date, endpoint_name, raw_json)
SELECT
  (CURRENT_DATE - s.i)::date,
  'sleep_data',
  jsonb_build_object(
    'dailySleepDTO', jsonb_build_object(
      'sleepStartTimestampLocal', (extract(epoch FROM (CURRENT_DATE - s.i - interval '1 day')::timestamp + interval '22 hours' + (random() * 3600 || ' seconds')::interval)::bigint * 1000)::bigint,
      'sleepEndTimestampLocal',   (extract(epoch FROM (CURRENT_DATE - s.i)::timestamp + interval '6 hours' + (random() * 3600 || ' seconds')::interval)::bigint * 1000)::bigint,
      'deepSleepSeconds',         ((50 + random() * 60) * 60)::int,
      'lightSleepSeconds',        ((180 + random() * 90) * 60)::int,
      'remSleepSeconds',          ((60 + random() * 60) * 60)::int,
      'awakeSleepSeconds',        ((5 + random() * 20) * 60)::int,
      'sleepTimeSeconds',         ((50 + random() * 60) * 60 + (180 + random() * 90) * 60 + (60 + random() * 60) * 60)::int,
      'averageSpO2Value',         (95 + random() * 4)::numeric(4,1),
      'lowestSpO2Value',          (92 + (random() * 4))::int,
      'averageRespirationValue',  (13 + random() * 4)::numeric(4,1),
      'avgHeartRate',             (50 + (random() * 15))::int,
      'sleepScores', jsonb_build_object(
        'overall', jsonb_build_object(
          'value', (65 + (random() * 30))::int,
          'qualifierKey', CASE
            WHEN random() > 0.7 THEN 'EXCELLENT'
            WHEN random() > 0.4 THEN 'GOOD'
            WHEN random() > 0.2 THEN 'FAIR'
            ELSE 'POOR'
          END
        )
      )
    )
  )
FROM generate_series(0, 729) AS s(i)
ON CONFLICT (date, endpoint_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- garmin_raw_data — user_summary (stress, body battery, RHR for sleep page)
-- -----------------------------------------------------------------------------
INSERT INTO garmin_raw_data (date, endpoint_name, raw_json)
SELECT
  d.date,
  'user_summary',
  jsonb_build_object(
    'restingHeartRate',       d.resting_heart_rate,
    'averageStressLevel',     d.avg_stress_level,
    'maxStressLevel',         d.max_stress_level,
    'bodyBatteryChargedValue',d.body_battery_charged,
    'bodyBatteryDrainedValue',d.body_battery_drained
  )
FROM daily_health_summary d
WHERE d.resting_heart_rate IS NOT NULL
ON CONFLICT (date, endpoint_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- garmin_raw_data — hrv_data
-- -----------------------------------------------------------------------------
INSERT INTO garmin_raw_data (date, endpoint_name, raw_json)
SELECT
  d.date,
  'hrv_data',
  jsonb_build_object(
    'hrvSummary', jsonb_build_object(
      'weeklyAvg',    d.hrv_weekly_avg,
      'lastNightAvg', d.hrv_last_night_avg,
      'status',       COALESCE(d.hrv_status, 'BALANCED')
    )
  )
FROM daily_health_summary d
WHERE d.hrv_weekly_avg IS NOT NULL AND d.hrv_weekly_avg > 0
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
        'vO2MaxValue',    ROUND((50 + random() * 8)::numeric, 1),
        'aerobicTrainingEffect', ROUND((2.5 + random() * 2)::numeric, 1),
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
        'distance',      ROUND((3000 + random() * 10000)::numeric, 1),
        'duration',      ROUND((1800 + random() * 5400)::numeric)::int,
        'averageHR',     (120 + (random() * 40)::int),
        'calories',      (200 + (random() * 500)::int),
        'activityType',  jsonb_build_object('typeKey', act_type),
        'maxSpeed',      CASE WHEN act_type IN ('cycling', 'running') THEN (6 + random() * 10)::float ELSE NULL END,
        'elevationGain', CASE WHEN act_type IN ('cycling', 'hiking') THEN (50 + random() * 400)::float ELSE NULL END
      )
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- hevy_raw_data — 60 gym sessions (Push / Pull / Legs split)
-- NOTE: sets must include 'type': 'normal' for the app to count them
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
        jsonb_build_object('title', 'Bench Press', 'exercise_template_id', 'bench-press', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 80 + (random()*10)::int, 'reps', 5),
          jsonb_build_object('type', 'normal', 'weight_kg', 80 + (random()*10)::int, 'reps', 5),
          jsonb_build_object('type', 'normal', 'weight_kg', 82 + (random()*8)::int,  'reps', 4)
        )),
        jsonb_build_object('title', 'Overhead Press', 'exercise_template_id', 'overhead-press', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 55 + (random()*8)::int, 'reps', 6),
          jsonb_build_object('type', 'normal', 'weight_kg', 55 + (random()*8)::int, 'reps', 6)
        )),
        jsonb_build_object('title', 'Tricep Pushdown', 'exercise_template_id', 'tricep-pushdown', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 30 + (random()*10)::int, 'reps', 12),
          jsonb_build_object('type', 'normal', 'weight_kg', 30 + (random()*10)::int, 'reps', 10)
        ))
      )
      WHEN 1 THEN jsonb_build_array(
        jsonb_build_object('title', 'Deadlift', 'exercise_template_id', 'deadlift', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 120 + (random()*20)::int, 'reps', 4),
          jsonb_build_object('type', 'normal', 'weight_kg', 120 + (random()*20)::int, 'reps', 4),
          jsonb_build_object('type', 'normal', 'weight_kg', 125 + (random()*15)::int, 'reps', 3)
        )),
        jsonb_build_object('title', 'Pull-Up', 'exercise_template_id', 'pull-up', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 0, 'reps', 10),
          jsonb_build_object('type', 'normal', 'weight_kg', 0, 'reps', 8),
          jsonb_build_object('type', 'normal', 'weight_kg', 0, 'reps', 7)
        )),
        jsonb_build_object('title', 'Barbell Row', 'exercise_template_id', 'barbell-row', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 70 + (random()*15)::int, 'reps', 8),
          jsonb_build_object('type', 'normal', 'weight_kg', 70 + (random()*15)::int, 'reps', 8)
        ))
      )
      ELSE jsonb_build_array(
        jsonb_build_object('title', 'Squat', 'exercise_template_id', 'squat', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 100 + (random()*20)::int, 'reps', 5),
          jsonb_build_object('type', 'normal', 'weight_kg', 100 + (random()*20)::int, 'reps', 5),
          jsonb_build_object('type', 'normal', 'weight_kg', 102 + (random()*18)::int, 'reps', 4)
        )),
        jsonb_build_object('title', 'Leg Press', 'exercise_template_id', 'leg-press', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 150 + (random()*30)::int, 'reps', 12),
          jsonb_build_object('type', 'normal', 'weight_kg', 150 + (random()*30)::int, 'reps', 10)
        )),
        jsonb_build_object('title', 'Romanian Deadlift', 'exercise_template_id', 'romanian-deadlift', 'sets', jsonb_build_array(
          jsonb_build_object('type', 'normal', 'weight_kg', 80 + (random()*15)::int, 'reps', 10),
          jsonb_build_object('type', 'normal', 'weight_kg', 80 + (random()*15)::int, 'reps', 10)
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

-- =============================================================================
-- GPS Route data for first 5 demo runs (activity_ids 1000000-1000004)
-- Simulates a ~5-7km loop run around Central Park, NYC
-- Structure matches real Garmin activityDetailMetrics format
-- =============================================================================
DO $$
DECLARE
  act_id    bigint;
  i         int;
  n         int := 360;       -- ~1 sample per 10 seconds, 60 minutes
  points    jsonb;
  t         float;
  lat       float;
  lng       float;
  center_lat float := 40.7851;
  center_lng float := -73.9683;
  lat_rad   float := 0.0135;  -- ~1.5km N-S radius
  lng_rad   float := 0.020;   -- ~1.7km E-W radius
  speed_ms  float;
  hr_val    float;
  elev_val  float;
  cadence_v float;
  ts_ms     bigint;
  dist_m    float;
  descriptors jsonb;
BEGIN
  -- Metric descriptors matching real Garmin structure
  descriptors := jsonb_build_array(
    jsonb_build_object('key','directTimestamp',    'metricsIndex',0),
    jsonb_build_object('key','directLatitude',     'metricsIndex',1),
    jsonb_build_object('key','directLongitude',    'metricsIndex',2),
    jsonb_build_object('key','directHeartRate',    'metricsIndex',3),
    jsonb_build_object('key','directSpeed',        'metricsIndex',4),
    jsonb_build_object('key','directElevation',    'metricsIndex',5),
    jsonb_build_object('key','directDoubleCadence','metricsIndex',6),
    jsonb_build_object('key','sumDistance',        'metricsIndex',7)
  );

  FOR act_id IN SELECT generate_series(1000000, 1000004) LOOP
    points   := '[]'::jsonb;
    ts_ms    := (extract(epoch FROM NOW()) * 1000)::bigint - (act_id - 1000000) * 604800000;
    dist_m   := 0;

    FOR i IN 0..(n-1) LOOP
      t         := (2.0 * pi() * i) / n;
      lat       := center_lat + lat_rad * sin(t);
      lng       := center_lng + lng_rad * cos(t);
      -- Varied speed: faster on flat, slower on hills
      speed_ms  := 2.8 + 0.9 * sin(3 * t) + (random() * 0.4 - 0.2);
      speed_ms  := GREATEST(speed_ms, 1.8);
      hr_val    := 142 + 18 * sin(2 * t + 0.5) + (random() * 6 - 3);
      elev_val  := 38 + 22 * sin(2 * t) + 8 * sin(5 * t);
      cadence_v := 170 + 12 * sin(t) + (random() * 6 - 3);
      dist_m    := dist_m + speed_ms * 10;
      ts_ms     := ts_ms + 10000;

      points := points || jsonb_build_array(
        jsonb_build_object('metrics', jsonb_build_array(
          ts_ms,
          round(lat::numeric, 6),
          round(lng::numeric, 6),
          round(hr_val::numeric, 0),
          round(speed_ms::numeric, 3),
          round(elev_val::numeric, 1),
          round(cadence_v::numeric, 0) * 2,   -- double cadence
          round(dist_m::numeric, 1)
        ))
      );
    END LOOP;

    INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json)
    VALUES (
      act_id,
      'details',
      jsonb_build_object(
        'metricDescriptors',     descriptors,
        'activityDetailMetrics', points
      )
    ) ON CONFLICT (activity_id, endpoint_name) DO NOTHING;
  END LOOP;
END $$;

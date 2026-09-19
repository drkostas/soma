-- Slide the public demo forward so it always shows current dates.
--
-- The demo is ONE consistent dataset that moves, never a fresh random seed.
-- Every streak, trend and relationship in it is real and stays real; only the
-- calendar under it advances. A reseed would break continuity between runs,
-- which is the thing this exists to avoid.
--
-- Run it weekly. It is SELF-CORRECTING rather than a fixed step:
--   * it computes how many whole weeks the newest reading is behind its target
--   * a week that never ran is caught up automatically on the next run
--   * running it twice in a day is a no-op, because the gap is then zero
-- So a missed Monday costs nothing and a double run cannot push the demo into
-- the future, which a fixed "+7 days" would do on both counts.
--
-- WHOLE WEEKS, always. Training happens on particular weekdays, and the
-- gym-frequency heatmap and the weekly load charts read as nonsense if Monday
-- sessions land on a Thursday.
--
-- EVERYTHING moves by the same amount, Garmin and nutrition alike. Shifting one
-- half only pulls the two apart by a week every week, and the demo would end up
-- showing meals from a month before its workouts.

-- meal_log.date and drink_log.date are FOREIGN KEYS onto nutrition_day.date, and
-- they are not deferrable as shipped. Parking a parent row leaves its children
-- pointing at nothing for the length of one statement, so the move has to be
-- checked at COMMIT rather than per statement. Made deferrable once, here,
-- because the alternative is dropping and recreating a constraint on a live
-- public database every week.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint WHERE contype = 'f' AND NOT condeferrable
      AND confrelid::regclass::text IN ('nutrition_day')
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', r.tbl, r.conname);
    RAISE NOTICE 'demo-drift: made % deferrable', r.conname;
  END LOOP;
END $$;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
  -- The newest real reading sits this far back, so the demo looks like an
  -- account synced a couple of days ago rather than one updated this instant.
  lag_days   constant int := 3;
  -- Parked far beyond any real data while a table is mid-move. Several tables
  -- are keyed on the date itself (daily_health_summary, nutrition_day,
  -- sleep_detail, analytics_weight_trend are PRIMARY KEY (date);
  -- garmin_raw_data is UNIQUE (date, endpoint_name)), so a direct "+7" lands on
  -- a row that already exists and the statement fails against itself. Parking
  -- the whole table out of range first means neither pass ever overlaps.
  park_days  constant int := 100000;
  targets    constant text[] := ARRAY[
    'daily_health_summary','garmin_raw_data','garmin_activity_raw','hevy_raw_data',
    'sleep_detail','workout_enrichment','activity_sync_log','analytics_weight_trend',
    'strava_raw_data','garmin_profile_raw','sync_log',
    'nutrition_day','meal_log','weight_log','drink_log'
  ];
  anchor     date;
  shift_days int;
  r          record;
  cols       int := 0;
BEGIN
  SELECT max(date) INTO anchor FROM daily_health_summary;
  IF anchor IS NULL THEN
    RAISE NOTICE 'demo-drift: no rows in daily_health_summary, nothing to move';
    RETURN;
  END IF;

  shift_days := (floor(((CURRENT_DATE - lag_days) - anchor)::numeric / 7) * 7)::int;

  IF shift_days <= 0 THEN
    RAISE NOTICE 'demo-drift: newest reading is % (target %), already current, nothing to do',
      anchor, CURRENT_DATE - lag_days;
    RETURN;
  END IF;

  RAISE NOTICE 'demo-drift: newest reading % is % week(s) behind, moving everything % days',
    anchor, shift_days / 7, shift_days;

  -- 1 · Date and timestamp columns, parked and returned so a table keyed on its
  --     own date cannot collide with itself.
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name = ANY(targets)
      AND c.data_type IN ('date','timestamp with time zone','timestamp without time zone')
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = %I + $1 WHERE %I IS NOT NULL',
                   r.table_name, r.column_name, r.column_name, r.column_name)
      USING make_interval(days => shift_days + park_days);
    EXECUTE format('UPDATE public.%I SET %I = %I - $1 WHERE %I IS NOT NULL',
                   r.table_name, r.column_name, r.column_name, r.column_name)
      USING make_interval(days => park_days);
    cols := cols + 1;
  END LOOP;

  -- 2 · ISO date strings nested anywhere inside the raw payloads. Both Running
  --     and Workouts read their dates out of raw_json, so columns alone would
  --     leave those two pages behind while the rest of the demo moved.
  EXECUTE format($f$
    UPDATE garmin_activity_raw SET raw_json = (
      SELECT string_agg(CASE WHEN part ~ '^\d{4}-\d{2}-\d{2}$'
                             THEN to_char(part::date + %s, 'YYYY-MM-DD') ELSE part END, '')::jsonb
      FROM regexp_split_to_table(raw_json::text,
             '(?=\d{4}-\d{2}-\d{2})|(?<=\d{4}-\d{2}-\d{2})') AS part)$f$, shift_days);
  EXECUTE format($f$
    UPDATE garmin_raw_data SET raw_json = (
      SELECT string_agg(CASE WHEN part ~ '^\d{4}-\d{2}-\d{2}$'
                             THEN to_char(part::date + %s, 'YYYY-MM-DD') ELSE part END, '')::jsonb
      FROM regexp_split_to_table(raw_json::text,
             '(?=\d{4}-\d{2}-\d{2})|(?<=\d{4}-\d{2}-\d{2})') AS part)$f$, shift_days);
  EXECUTE format($f$
    UPDATE hevy_raw_data SET raw_json = (
      SELECT string_agg(CASE WHEN part ~ '^\d{4}-\d{2}-\d{2}$'
                             THEN to_char(part::date + %s, 'YYYY-MM-DD') ELSE part END, '')::jsonb
      FROM regexp_split_to_table(raw_json::text,
             '(?=\d{4}-\d{2}-\d{2})|(?<=\d{4}-\d{2}-\d{2})') AS part)$f$, shift_days);

  -- 3 · The epoch-millis Garmin writes beside its ISO strings. Left behind it
  --     would still say February while startTimeLocal said September, and the
  --     two are read by different code paths.
  EXECUTE format($f$
    UPDATE garmin_activity_raw
    SET raw_json = jsonb_set(raw_json, '{beginTimestamp}',
                     to_jsonb((raw_json->>'beginTimestamp')::bigint + %s::bigint * 86400000))
    WHERE jsonb_typeof(raw_json) = 'object'
      AND raw_json ? 'beginTimestamp'
      AND (raw_json->>'beginTimestamp') ~ '^\d+$'$f$, shift_days);

  RAISE NOTICE 'demo-drift: moved % column(s) plus the raw payloads', cols;
END $$;

COMMIT;

ANALYZE;

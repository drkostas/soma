-- Say what you ate (soma#1008/#1009). Additive; applied to verify_soma first, then to soma.
--
-- The capture row holds the owner's sentence, the thread it grew into, and how far it has got.
-- It is separate from meal_log because it exists BEFORE there is a meal: the words are saved the
-- instant they are sent, by a route that never calls a model, and the meal fills in behind them.
-- Everything downstream can be retried; the sentence cannot be recomputed.
CREATE TABLE IF NOT EXISTS meal_capture (
  id            bigserial PRIMARY KEY,
  date          date        NOT NULL,
  meal_slot     varchar     NULL,
  mode          varchar     NOT NULL DEFAULT 'log',      -- 'log' | 'calibrate'
  status        varchar     NOT NULL DEFAULT 'captured', -- captured|running|ready|logged|failed
  messages      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  proposal      jsonb       NULL,
  resolved      jsonb       NULL,
  meal_log_id   integer     NULL REFERENCES meal_log(id) ON DELETE SET NULL,
  error         text        NULL,
  attempts      int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meal_capture_status_idx ON meal_capture (status, created_at);
CREATE INDEX IF NOT EXISTS meal_capture_date_idx   ON meal_capture (date);

-- The log-or-calibrate toggle, remembered so web, app and widget start from the same choice.
ALTER TABLE nutrition_profile
  ADD COLUMN IF NOT EXISTS capture_mode_default varchar NOT NULL DEFAULT 'log';

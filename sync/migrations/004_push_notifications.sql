-- Push notification subscriptions (one per device/browser)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              SERIAL PRIMARY KEY,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Notification preferences (single row, personal dashboard)
CREATE TABLE IF NOT EXISTS notification_preferences (
    id                  SERIAL PRIMARY KEY,
    enabled             BOOLEAN DEFAULT true,
    on_sync_workout     BOOLEAN DEFAULT true,
    on_sync_run         BOOLEAN DEFAULT true,
    on_sync_error       BOOLEAN DEFAULT true,
    on_milestone        BOOLEAN DEFAULT true,
    on_playlist_ready   BOOLEAN DEFAULT false,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default preferences row
INSERT INTO notification_preferences (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

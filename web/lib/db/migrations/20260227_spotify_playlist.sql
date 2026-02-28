-- Migration: 20260227_spotify_playlist
-- Description: Data layer for the BPM-matched Spotify Playlist Builder
-- Apply: psql "$DATABASE_URL" -f web/lib/db/migrations/20260227_spotify_playlist.sql

-- Cached track BPM/energy/valence from ReccoBeats
CREATE TABLE IF NOT EXISTS spotify_track_features (
  track_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  tempo FLOAT,
  energy FLOAT,
  valence FLOAT,
  danceability FLOAT,
  genres TEXT[] DEFAULT '{}',
  raw_genres TEXT[] DEFAULT '{}',
  cached_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stf_tempo ON spotify_track_features(tempo);
CREATE INDEX IF NOT EXISTS idx_stf_genres ON spotify_track_features USING GIN(genres);

-- Cached artist genres (from Spotify + Last.fm fallback)
CREATE TABLE IF NOT EXISTS spotify_artist_genres (
  artist_id TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL,
  genres TEXT[] DEFAULT '{}',
  macro_genres TEXT[] DEFAULT '{}',
  source TEXT DEFAULT 'spotify',
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved workout plans (manual or from Garmin)
CREATE TABLE IF NOT EXISTS workout_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sport_type TEXT DEFAULT 'running',
  segments JSONB NOT NULL DEFAULT '[]',
  total_duration_s INTEGER,
  source TEXT DEFAULT 'manual',
  garmin_activity_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Playlist sessions (one per playlist generated)
CREATE TABLE IF NOT EXISTS playlist_sessions (
  id SERIAL PRIMARY KEY,
  workout_plan_id INTEGER REFERENCES workout_plans(id) ON DELETE SET NULL,
  garmin_activity_id TEXT,
  source_playlist_ids TEXT[] DEFAULT '{}',
  genre_selection TEXT[] DEFAULT '{}',
  genre_threshold FLOAT DEFAULT 0.03,
  song_assignments JSONB DEFAULT '{}',
  excluded_track_ids TEXT[] DEFAULT '{}',
  spotify_playlist_id TEXT,
  spotify_playlist_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-segment-type user preferences (persisted across sessions)
CREATE TABLE IF NOT EXISTS playlist_preferences (
  segment_type TEXT PRIMARY KEY,
  sync_mode TEXT DEFAULT 'auto',
  bpm_min INTEGER,
  bpm_max INTEGER,
  bpm_tolerance INTEGER DEFAULT 8,
  valence_min FLOAT,
  valence_max FLOAT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permanently excluded tracks (never suggest again)
CREATE TABLE IF NOT EXISTS user_blacklist (
  track_id TEXT PRIMARY KEY,
  name TEXT,
  artist_name TEXT,
  blacklisted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-track exclude count for blacklist learning (3 excludes → prompt)
CREATE TABLE IF NOT EXISTS track_exclude_counts (
  track_id TEXT PRIMARY KEY,
  exclude_count INTEGER DEFAULT 1,
  last_excluded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pump-up song bank (max 10, user-curated)
CREATE TABLE IF NOT EXISTS pump_up_songs (
  track_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  tempo FLOAT,
  energy FLOAT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

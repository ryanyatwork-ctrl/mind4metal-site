-- D1 schema for the shared "recently played" list.
-- Already applied to database `mind4metal-recent-tracks`
-- (id f648b4ae-bbff-4818-8955-28bdf4343b5a) on 2026-06-05.
-- Re-runnable (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS recent_tracks (
  combo     TEXT PRIMARY KEY,   -- `${artist}|||${title}`.toLowerCase()
  artist    TEXT NOT NULL,
  title     TEXT NOT NULL,
  listeners INTEGER,
  raw       TEXT,
  played_at TEXT NOT NULL       -- ISO timestamp
);

CREATE INDEX IF NOT EXISTS idx_recent_played_at ON recent_tracks(played_at DESC);

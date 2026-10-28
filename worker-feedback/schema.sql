-- D1 schema of the Plot Bhai feedback Worker (see docs/feedback.md). Safe to run again.
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
-- Daily counts per hashed browser or hashed IP, for the limits; rows older than two days are deleted.
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  who TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, kind, who)
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  browser TEXT NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  tool TEXT NOT NULL,
  verdict TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS validations_status ON validations (status, id);

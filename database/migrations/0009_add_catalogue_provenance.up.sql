ALTER TABLE master_catalogue_entries
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS catalogue_seed_runs (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  seeded_at TIMESTAMPTZ NOT NULL,
  source_file_name TEXT NOT NULL,
  inserted INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  unchanged INTEGER NOT NULL,
  retired INTEGER NOT NULL,
  reinstated INTEGER NOT NULL,
  error_count INTEGER NOT NULL
);

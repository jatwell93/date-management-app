DROP TABLE IF EXISTS catalogue_seed_runs;

ALTER TABLE master_catalogue_entries
  DROP COLUMN IF EXISTS retired_at;

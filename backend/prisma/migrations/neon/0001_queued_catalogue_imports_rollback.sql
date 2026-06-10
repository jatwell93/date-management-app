DROP INDEX IF EXISTS uploads_one_active_catalogue_per_org;
ALTER TABLE uploads
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS processing_started_at,
  DROP COLUMN IF EXISTS validation_started_at,
  DROP COLUMN IF EXISTS queued_at,
  DROP COLUMN IF EXISTS error_report_key,
  DROP COLUMN IF EXISTS failure_category,
  DROP COLUMN IF EXISTS retry_count,
  DROP COLUMN IF EXISTS processing_offset,
  DROP COLUMN IF EXISTS row_errors,
  DROP COLUMN IF EXISTS rows_unchanged,
  DROP COLUMN IF EXISTS max_active_expiries_snapshot,
  DROP COLUMN IF EXISTS max_skus_snapshot,
  DROP COLUMN IF EXISTS tier_snapshot,
  DROP COLUMN IF EXISTS import_type;

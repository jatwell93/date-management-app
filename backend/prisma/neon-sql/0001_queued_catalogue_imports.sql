ALTER TABLE uploads
  ADD COLUMN IF NOT EXISTS import_type text NOT NULL DEFAULT 'product-catalog',
  ADD COLUMN IF NOT EXISTS tier_snapshot text,
  ADD COLUMN IF NOT EXISTS max_skus_snapshot integer,
  ADD COLUMN IF NOT EXISTS max_active_expiries_snapshot integer,
  ADD COLUMN IF NOT EXISTS rows_unchanged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS row_errors text,
  ADD COLUMN IF NOT EXISTS processing_offset integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_category text,
  ADD COLUMN IF NOT EXISTS error_report_key text,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uploads_one_active_catalogue_per_org
  ON uploads (organization_id)
  WHERE import_type = 'product-catalog'
    AND status IN ('pending', 'queued', 'validating', 'processing');


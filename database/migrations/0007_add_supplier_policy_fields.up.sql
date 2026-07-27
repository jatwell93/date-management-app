ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS representative_name text,
  ADD COLUMN IF NOT EXISTS representative_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS policy_updated_at timestamp(3);

UPDATE suppliers
SET policy_updated_at = updated_at
WHERE policy_updated_at IS NULL
  AND trim(credit_policy_note) <> '';

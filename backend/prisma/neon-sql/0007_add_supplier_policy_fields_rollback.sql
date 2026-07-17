ALTER TABLE suppliers
  DROP COLUMN IF EXISTS policy_updated_at,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS representative_email,
  DROP COLUMN IF EXISTS representative_name;

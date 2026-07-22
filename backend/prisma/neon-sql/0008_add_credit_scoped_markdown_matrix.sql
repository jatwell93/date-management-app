ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS credit_type text NOT NULL DEFAULT 'NONE';

UPDATE suppliers SET credit_type = 'NONE' WHERE credit_type IS NULL;

ALTER TABLE suppliers
  DROP CONSTRAINT IF EXISTS suppliers_credit_type_check;
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_credit_type_check
  CHECK (credit_type IN ('NONE', 'FULL_CREDIT'));

ALTER TABLE organization_markdown_config
  ADD COLUMN IF NOT EXISTS credit_scope text NOT NULL DEFAULT 'NO_CREDIT';

UPDATE organization_markdown_config
SET credit_scope = 'NO_CREDIT'
WHERE credit_scope IS NULL;

ALTER TABLE organization_markdown_config
  DROP CONSTRAINT IF EXISTS organization_markdown_config_organization_id_key;
ALTER TABLE organization_markdown_config
  DROP CONSTRAINT IF EXISTS organization_markdown_config_org_scope_key;
ALTER TABLE organization_markdown_config
  DROP CONSTRAINT IF EXISTS organization_markdown_config_credit_scope_check;
ALTER TABLE organization_markdown_config
  ADD CONSTRAINT organization_markdown_config_credit_scope_check
  CHECK (credit_scope IN ('NO_CREDIT', 'FULL_CREDIT'));
ALTER TABLE organization_markdown_config
  ADD CONSTRAINT organization_markdown_config_org_scope_key
  UNIQUE (organization_id, credit_scope);

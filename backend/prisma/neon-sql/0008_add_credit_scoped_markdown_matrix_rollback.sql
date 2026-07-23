DELETE FROM organization_markdown_config WHERE credit_scope = 'FULL_CREDIT';

ALTER TABLE organization_markdown_config
  DROP CONSTRAINT IF EXISTS organization_markdown_config_org_scope_key;
ALTER TABLE organization_markdown_config
  ADD CONSTRAINT organization_markdown_config_organization_id_key UNIQUE (organization_id);
ALTER TABLE organization_markdown_config
  DROP CONSTRAINT IF EXISTS organization_markdown_config_credit_scope_check;
ALTER TABLE organization_markdown_config
  DROP COLUMN IF EXISTS credit_scope;

ALTER TABLE suppliers
  DROP CONSTRAINT IF EXISTS suppliers_credit_type_check;
ALTER TABLE suppliers
  DROP COLUMN IF EXISTS credit_type;

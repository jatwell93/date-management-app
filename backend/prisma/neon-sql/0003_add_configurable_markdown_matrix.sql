-- Configurable markdown matrix (issue #338).
-- 1. Store retail price as a value distinct from cost, so a markdown band can be
--    taken off retail. Nullable: existing cost-only catalogues stay valid.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS retail_price double precision;

-- 2. Per-organization markdown matrix: three bands, each a discount percentage
--    (0-100) taken off cost or retail. Defaults reproduce the previous hardcoded
--    ladder (50/60/75% off cost) so untouched orgs are unchanged.
CREATE TABLE IF NOT EXISTS organization_markdown_config (
  id               serial PRIMARY KEY,
  organization_id  text NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
  band1_percentage double precision NOT NULL DEFAULT 50,
  band2_percentage double precision NOT NULL DEFAULT 60,
  band3_percentage double precision NOT NULL DEFAULT 75,
  band1_basis      text NOT NULL DEFAULT 'cost',
  band2_basis      text NOT NULL DEFAULT 'cost',
  band3_basis      text NOT NULL DEFAULT 'cost',
  created_at       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_markdown_config_band1_basis_check CHECK (band1_basis IN ('cost', 'retail')),
  CONSTRAINT organization_markdown_config_band2_basis_check CHECK (band2_basis IN ('cost', 'retail')),
  CONSTRAINT organization_markdown_config_band3_basis_check CHECK (band3_basis IN ('cost', 'retail')),
  CONSTRAINT organization_markdown_config_band1_pct_check CHECK (band1_percentage BETWEEN 0 AND 100),
  CONSTRAINT organization_markdown_config_band2_pct_check CHECK (band2_percentage BETWEEN 0 AND 100),
  CONSTRAINT organization_markdown_config_band3_pct_check CHECK (band3_percentage BETWEEN 0 AND 100)
);

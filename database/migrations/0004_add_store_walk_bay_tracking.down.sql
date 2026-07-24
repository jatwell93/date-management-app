DROP TRIGGER IF EXISTS bay_checks_leaf_store_area_check ON bay_checks;
DROP FUNCTION IF EXISTS enforce_bay_check_leaf_store_area();

DROP TABLE IF EXISTS bay_checks;
DROP TABLE IF EXISTS check_cycles;

ALTER TABLE store_areas
  DROP CONSTRAINT IF EXISTS store_areas_parent_not_self_check;

ALTER TABLE store_areas
  DROP CONSTRAINT IF EXISTS store_areas_parent_id_fkey;

DROP INDEX IF EXISTS idx_store_areas_parent_id;

ALTER TABLE store_areas
  DROP COLUMN IF EXISTS parent_id;

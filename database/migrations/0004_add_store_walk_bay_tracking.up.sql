-- Store-walk bay-check tracking.
-- StoreArea gains a parent_id self-reference: NULL = department, set = bay.
ALTER TABLE store_areas
  ADD COLUMN IF NOT EXISTS parent_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_areas_parent_id_fkey'
      AND conrelid = 'store_areas'::regclass
  ) THEN
    ALTER TABLE store_areas
      ADD CONSTRAINT store_areas_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES store_areas (id) ON DELETE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_areas_parent_not_self_check'
      AND conrelid = 'store_areas'::regclass
  ) THEN
    ALTER TABLE store_areas
      ADD CONSTRAINT store_areas_parent_not_self_check
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_store_areas_parent_id
  ON store_areas (parent_id);

DROP TABLE IF EXISTS pg_temp.store_area_backfill_bays;

CREATE TEMP TABLE store_area_backfill_bays AS
  SELECT
    id,
    organization_id,
    COALESCE(NULLIF(BTRIM(sub_department), ''), 'Unassigned') AS department_name
  FROM store_areas AS bay
  WHERE parent_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM store_areas AS child
      WHERE child.parent_id = bay.id
    );

INSERT INTO store_areas (
  organization_id,
  name,
  sub_department,
  last_checked,
  created_at,
  updated_at
)
SELECT
  candidate.organization_id,
  candidate.department_name,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT organization_id, department_name
  FROM store_area_backfill_bays
) AS candidate
WHERE NOT EXISTS (
  SELECT 1
  FROM store_areas AS existing
  WHERE existing.organization_id = candidate.organization_id
    AND existing.parent_id IS NULL
    AND existing.name = candidate.department_name
    AND existing.sub_department IS NULL
);

UPDATE store_areas AS bay
SET parent_id = department.id
FROM store_area_backfill_bays AS backfill
JOIN LATERAL (
  SELECT id
  FROM store_areas
  WHERE organization_id = backfill.organization_id
    AND parent_id IS NULL
    AND name = backfill.department_name
    AND sub_department IS NULL
  ORDER BY id
  LIMIT 1
) AS department ON TRUE
WHERE bay.id = backfill.id
  AND bay.parent_id IS NULL;

DROP TABLE IF EXISTS pg_temp.store_area_backfill_bays;

CREATE TABLE IF NOT EXISTS check_cycles (
  id              serial PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  started_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    timestamp(3),
  created_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_cycles_status_check CHECK (status IN ('active', 'completed')),
  CONSTRAINT check_cycles_completed_at_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status = 'active' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_check_cycles_organization_id
  ON check_cycles (organization_id);

CREATE INDEX IF NOT EXISTS idx_check_cycles_started_at
  ON check_cycles (started_at);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_cycle_per_org
  ON check_cycles (organization_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bay_checks (
  id                serial PRIMARY KEY,
  organization_id   text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  cycle_id          integer NOT NULL REFERENCES check_cycles (id) ON DELETE CASCADE,
  store_area_id     integer NOT NULL REFERENCES store_areas (id) ON DELETE CASCADE,
  user_id           integer REFERENCES users (id) ON DELETE SET NULL,
  checked_at        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  items_added_count integer NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bay_checks_items_added_count_check CHECK (items_added_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bay_checks_organization_id
  ON bay_checks (organization_id);

CREATE INDEX IF NOT EXISTS idx_bay_checks_cycle_id
  ON bay_checks (cycle_id);

CREATE INDEX IF NOT EXISTS idx_bay_checks_store_area_id
  ON bay_checks (store_area_id);

CREATE INDEX IF NOT EXISTS idx_bay_checks_checked_at
  ON bay_checks (checked_at);

CREATE OR REPLACE FUNCTION enforce_bay_check_leaf_store_area()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM store_areas
    WHERE id = NEW.store_area_id
      AND organization_id = NEW.organization_id
      AND parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'bay_checks.store_area_id must reference a leaf bay in the same organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM check_cycles
    WHERE id = NEW.cycle_id
      AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'bay_checks.cycle_id must reference a cycle in the same organization';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bay_checks_leaf_store_area_check ON bay_checks;
CREATE TRIGGER bay_checks_leaf_store_area_check
  BEFORE INSERT OR UPDATE ON bay_checks
  FOR EACH ROW
  EXECUTE FUNCTION enforce_bay_check_leaf_store_area();

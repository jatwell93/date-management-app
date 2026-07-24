/**
 * Catalog introspection and normalization for the baseline fingerprint test.
 *
 * Provides `introspectCatalog` (queries `pg_catalog`/`information_schema` for
 * every table, column, index, constraint, function, and trigger in the `public`
 * schema) and normalization helpers for deep comparison.
 *
 * Used by both the fingerprint generation script and the test file. Has no
 * pglite dependency — accepts any client with a `query` method that returns
 * `{ rows: unknown[] }`.
 */

/** A raw catalog row as returned by PostgreSQL introspection queries. */
export interface Catalog {
  tables: TableRow[];
  columns: ColumnRow[];
  indexes: IndexRow[];
  constraints: ConstraintRow[];
  functions: FunctionRow[];
  triggers: TriggerRow[];
}

export interface TableRow {
  table_name: string;
}

export interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
}

export interface IndexRow {
  table_name: string;
  index_name: string;
  index_def: string;
  is_unique: boolean;
  is_primary: boolean;
  partial_predicate: string | null;
}

export interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  contype: string;
  definition: string;
}

export interface FunctionRow {
  function_name: string;
  definition: string;
}

export interface TriggerRow {
  table_name: string;
  trigger_name: string;
  action_timing: string;
  event_manipulation: string;
  action_statement: string;
}

/** A client that can run SQL queries and return rows. */
export interface QueryClient {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * Introspect the full catalog of the `public` schema.
 *
 * Uses `pg_catalog` functions (`format_type`, `pg_get_indexdef`,
 * `pg_get_constraintdef`, `pg_get_functiondef`, `pg_get_expr`) for canonical
 * representations that are stable across Postgres versions.
 */
export async function introspectCatalog(client: QueryClient): Promise<Catalog> {
  const [tables, columns, indexes, constraints, functions, triggers] = await Promise.all([
    client
      .query(
        `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           ORDER BY table_name`,
      )
      .then((r) => r.rows as TableRow[]),
    client
      .query(
        `SELECT
             c.relname AS table_name,
             a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type,
             CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
             pg_get_expr(d.adbin, d.adrelid) AS column_default,
             a.attnum AS ordinal_position
           FROM pg_attribute a
           JOIN pg_class c ON a.attrelid = c.oid
           JOIN pg_namespace n ON c.relnamespace = n.oid
           LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND a.attnum > 0 AND NOT a.attisdropped
           ORDER BY c.relname, a.attnum`,
      )
      .then((r) => r.rows as ColumnRow[]),
    client
      .query(
        `SELECT
             c.relname AS table_name,
             i.relname AS index_name,
             pg_get_indexdef(ix.indexrelid) AS index_def,
             ix.indisunique AS is_unique,
             ix.indisprimary AS is_primary,
             pg_get_expr(ix.indpred, ix.indrelid) AS partial_predicate
           FROM pg_index ix
           JOIN pg_class c ON ix.indrelid = c.oid
           JOIN pg_class i ON ix.indexrelid = i.oid
           JOIN pg_namespace n ON c.relnamespace = n.oid
           WHERE n.nspname = 'public'
           ORDER BY c.relname, i.relname`,
      )
      .then((r) => r.rows as IndexRow[]),
    client
      .query(
        `SELECT
             conrelid::regclass::text AS table_name,
             conname AS constraint_name,
             contype,
             pg_get_constraintdef(con.oid) AS definition
           FROM pg_constraint con
           JOIN pg_class c ON con.conrelid = c.oid
           WHERE con.connamespace = 'public'::regnamespace AND c.relkind = 'r'
           ORDER BY conrelid::regclass::text, conname`,
      )
      .then((r) => r.rows as ConstraintRow[]),
    client
      .query(
        `SELECT
             p.proname AS function_name,
             pg_get_functiondef(p.oid) AS definition
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public'
           ORDER BY p.proname`,
      )
      .then((r) => r.rows as FunctionRow[]),
    client
      .query(
        `SELECT
             event_object_table AS table_name,
             trigger_name,
             action_timing,
             event_manipulation,
             action_statement
           FROM information_schema.triggers
           WHERE trigger_schema = 'public'
           ORDER BY event_object_table, trigger_name, event_manipulation`,
      )
      .then((r) => r.rows as TriggerRow[]),
  ]);

  return { tables, columns, indexes, constraints, functions, triggers };
}

// ---------------------------------------------------------------------------
// Normalization for the checked-in fingerprint (keeps names; normalizes types).
// ---------------------------------------------------------------------------

/**
 * Normalize a PostgreSQL type string for stable comparison.
 *
 * `timestamp(3) without time zone` and `timestamp(3) without time zone` should
 * match. We don't collapse `timestamp with time zone` and
 * `timestamp(3) without time zone` — they are genuinely different types and a
 * mismatch should be caught.
 */
export function normalizeType(type: string): string {
  return type.trim().toLowerCase();
}

/**
 * Normalize a column default expression for stable comparison.
 *
 * Sequence names in `nextval(...)` include the schema-qualified sequence name
 * which is deterministic within a single database, so we keep them. We only
 * strip whitespace differences.
 */
export function normalizeDefault(defaultExpr: string | null): string | null {
  if (defaultExpr === null) return null;
  return defaultExpr.trim();
}

/**
 * A normalized catalog entry suitable for JSON serialization and deep comparison.
 */
export interface NormalizedCatalog {
  tables: string[];
  columns: Array<{
    table: string;
    name: string;
    type: string;
    not_null: boolean;
    default: string | null;
  }>;
  indexes: Array<{
    table: string;
    name: string;
    definition: string;
    unique: boolean;
    primary: boolean;
    predicate: string | null;
  }>;
  constraints: Array<{
    table: string;
    name: string;
    type: string;
    definition: string;
  }>;
  functions: Array<{ name: string; definition: string }>;
  triggers: Array<{
    table: string;
    name: string;
    timing: string;
    events: string[];
    statement: string;
  }>;
}

/**
 * Normalize a raw catalog for the checked-in fingerprint.
 *
 * Keeps object names (they are deterministic in the migration replay and part
 * of the schema contract). Normalizes type strings and default expressions.
 * Groups triggers by (table, name) so multiple events on the same trigger are
 * collected into one entry with a sorted `events` array.
 */
export function normalizeCatalog(catalog: Catalog): NormalizedCatalog {
  const triggerMap = new Map<
    string,
    { table: string; name: string; timing: string; events: string[]; statement: string }
  >();
  for (const t of catalog.triggers) {
    const key = `${t.table_name}|${t.trigger_name}`;
    const existing = triggerMap.get(key);
    if (existing) {
      existing.events.push(t.event_manipulation);
    } else {
      triggerMap.set(key, {
        table: t.table_name,
        name: t.trigger_name,
        timing: t.action_timing,
        events: [t.event_manipulation],
        statement: t.action_statement,
      });
    }
  }
  for (const t of triggerMap.values()) {
    t.events.sort();
  }

  return {
    tables: catalog.tables.map((t) => t.table_name),
    columns: catalog.columns.map((c) => ({
      table: c.table_name,
      name: c.column_name,
      type: normalizeType(c.data_type),
      not_null: c.is_nullable === 'NO',
      default: normalizeDefault(c.column_default),
    })),
    indexes: catalog.indexes.map((i) => ({
      table: i.table_name,
      name: i.index_name,
      definition: i.index_def,
      unique: i.is_unique,
      primary: i.is_primary,
      predicate: i.partial_predicate,
    })),
    constraints: catalog.constraints.map((c) => ({
      table: c.table_name,
      name: c.constraint_name,
      type: c.contype,
      definition: c.definition,
    })),
    functions: catalog.functions.map((f) => ({
      name: f.function_name,
      definition: f.definition,
    })),
    triggers: Array.from(triggerMap.values()).sort((a, b) =>
      a.table === b.table ? a.name.localeCompare(b.name) : a.table.localeCompare(b.table),
    ),
  };
}

// ---------------------------------------------------------------------------
// Structural keys for cross-comparison (ignores names; compares by structure).
// ---------------------------------------------------------------------------

/**
 * A structural key for a column — ignores nothing (columns should match exactly
 * between migration-derived and Prisma-derived schemas, modulo type differences
 * that are in the allowlist).
 */
export function columnStructuralKey(c: {
  table: string;
  name: string;
  type: string;
  not_null: boolean;
  default: string | null;
}): string {
  return `${c.table}|${c.name}|${c.type}|${c.not_null}|${c.default}`;
}

/**
 * A structural key for an index — ignores the index name (Prisma generates
 * different names than hand-written SQL). Compares by table, definition body
 * (normalized to strip the name), uniqueness, primary flag, and partial predicate.
 */
export function indexStructuralKey(i: {
  table: string;
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
  predicate: string | null;
}): string {
  // Extract the structural part of the index definition: everything after
  // the index name. E.g. "CREATE UNIQUE INDEX foo ON bar (col1, col2) WHERE ..."
  // → "ON bar (col1, col2) WHERE ..."
  const def = i.definition.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, '');
  const afterName = def.substring(def.indexOf(' ON ') + 1);
  return `${i.table}|${afterName}|${i.unique}|${i.primary}|${i.predicate}`;
}

/**
 * Normalize a constraint definition for structural comparison.
 *
 * Strips quoted identifiers (Prisma quotes all identifiers; hand-written SQL
 * may not) and `ON UPDATE` actions (Prisma generates `ON UPDATE CASCADE` on all
 * FKs; migrations omit it, defaulting to `NO ACTION`). Since all FK references
 * target primary key `id` columns that are immutable, the `ON UPDATE` action
 * is practically irrelevant and is stripped for comparison.
 */
function normalizeConstraintDefinition(def: string): string {
  return (
    def
      .replace(/"/g, '') // strip quoted identifiers
      .replace(/\s+ON UPDATE\s+(CASCADE|NO ACTION|RESTRICT|SET NULL|SET DEFAULT)/gi, '')
      // ON DELETE NO ACTION is the PostgreSQL default; ON DELETE RESTRICT is
      // functionally equivalent for non-deferrable constraints (Prisma generates
      // RESTRICT for relations without explicit onDelete; migrations omit it).
      // Normalize both to empty for comparison.
      .replace(/\s+ON DELETE\s+(NO ACTION|RESTRICT)/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * A structural key for a constraint — ignores the constraint name. Compares by
 * table, constraint type, and normalized definition.
 */
export function constraintStructuralKey(c: {
  table: string;
  name: string;
  type: string;
  definition: string;
}): string {
  return `${c.table}|${c.type}|${normalizeConstraintDefinition(c.definition)}`;
}

/**
 * A structural key for a function — compares by name and definition.
 */
export function functionStructuralKey(f: { name: string; definition: string }): string {
  return `${f.name}|${f.definition}`;
}

/**
 * A structural key for a trigger — compares by table, timing, events, statement.
 */
export function triggerStructuralKey(t: {
  table: string;
  name: string;
  timing: string;
  events: string[];
  statement: string;
}): string {
  return `${t.table}|${t.timing}|${t.events.join(',')}|${t.statement}`;
}

/**
 * Compute the set difference of two string arrays: items in `actual` that are
 * not in `expected`. Returns a sorted array of missing items.
 */
export function setDifference(actual: string[], expected: string[]): string[] {
  const expectedSet = new Set(expected);
  return actual.filter((k) => !expectedSet.has(k));
}

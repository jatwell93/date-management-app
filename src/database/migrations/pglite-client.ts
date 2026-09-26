/**
 * Shared pglite adapter for the migration runner.
 *
 * pglite's `query` rejects multi-statement SQL, so the adapter routes
 * parameterless non-SELECT statements through `pg.exec` and everything else
 * through `pg.query`. This module is intentionally free of a runtime
 * `@electric-sql/pglite` import — the root project compiles to CommonJS while
 * pglite is ESM-only — so the instance type is a structural interface.
 */
import type { MigrationClient } from './runner';

export interface PgliteInstance {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
}

export function createPgliteMigrationClient(pg: PgliteInstance): MigrationClient {
  return {
    async query(text: string, values?: readonly unknown[]) {
      if (values !== undefined && values.length > 0) {
        const result = await pg.query(text, values as unknown[]);
        return { rows: result.rows as unknown[] };
      }
      const trimmed = text.trimStart();
      if (trimmed.toUpperCase().startsWith('SELECT')) {
        const result = await pg.query(text);
        return { rows: result.rows as unknown[] };
      }
      await pg.exec(text);
      return { rows: [] };
    },
  };
}

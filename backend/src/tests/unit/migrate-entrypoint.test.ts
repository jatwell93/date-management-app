import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Behavioral test: `npm run migrate` must actually run migrations. Previously
// migrate.ts exported runMigrations but never invoked it, so the command was a
// silent no-op. Rather than grep the source for the guard, run the real script
// as its own process (so `require.main === module` is true) against a throwaway
// SQLite file and assert the schema was created end-to-end.
describe('migration script entrypoint', () => {
  const backendRoot = path.resolve(__dirname, '../../..');
  const scriptPath = path.join(backendRoot, 'src/migrations/migrate.ts');
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'migrate-entrypoint-'));
    dbPath = path.join(tmpDir, 'migrate-test.sqlite');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs migrations end-to-end when executed directly', () => {
    const result = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', scriptPath],
      {
        cwd: backendRoot,
        encoding: 'utf8',
        timeout: 60000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          JWT_SECRET: 'test-secret',
          DATABASE_PATH: dbPath,
        },
      },
    );

    expect(result.status).toBe(0);

    // The entrypoint genuinely ran runMigrations(): the migrations bookkeeping
    // table and a first-migration table now exist in the fresh database.
    const db = new Database(dbPath, { readonly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('migrations');
      expect(tableNames).toContain('products');
    } finally {
      db.close();
    }
  }, 60000);
});

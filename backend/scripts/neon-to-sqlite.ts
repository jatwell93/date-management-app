/**
 * Neon -> SQLite emergency export utility.
 *
 * Purpose:
 * - Export PostgreSQL (Neon) tables to a SQLite backup file for rollback scenarios.
 * - Verify row-count integrity after export.
 * - Optionally capture a raw pg_dump snapshot alongside the SQLite export.
 *
 * Usage:
 *   npx ts-node scripts/neon-to-sqlite.ts --output ./backups/neon-export.sqlite
 *   npx ts-node scripts/neon-to-sqlite.ts --dry-run
 *   npx ts-node scripts/neon-to-sqlite.ts --tables organizations,users,products
 *
 * Required environment:
 *   NEON_CONNECTION_STRING (preferred) or DATABASE_URL
 */

import { Pool } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { parseArgs } from 'node:util';

type Primitive = string | number | bigint | boolean | null;

interface TableColumn {
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
}

interface ExportTableSummary {
  tableName: string;
  columns: number;
  sourceRows: number;
  sqliteRows: number;
  status: 'ok' | 'skipped' | 'error';
  message?: string;
}

interface ExportManifest {
  generatedAt: string;
  source: {
    provider: 'neon-postgresql';
    schema: string;
    tableCount: number;
    tables: string[];
  };
  destination: {
    sqlitePath?: string;
    dryRun: boolean;
    manifestPath: string;
    pgDumpPath?: string;
  };
  integrity: {
    tablesVerified: number;
    rowsVerified: number;
    mismatches: Array<{ tableName: string; sourceRows: number; sqliteRows: number }>;
  };
  tables: ExportTableSummary[];
}

interface ScriptOptions {
  output: string;
  manifest: string;
  schema: string;
  dryRun: boolean;
  includePgDump: boolean;
  pgDumpOutput: string;
  pgDumpPath?: string;
  tables?: string[];
  neonUrl: string;
}

function printUsage(): void {
  console.log('Neon to SQLite Export');
  console.log('');
  console.log('Usage:');
  console.log('  npx ts-node scripts/neon-to-sqlite.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --output <path>          Output SQLite file path');
  console.log('  --manifest <path>        Manifest JSON path');
  console.log('  --schema <name>          PostgreSQL schema (default: public)');
  console.log('  --tables <csv>           Comma-separated table names to export');
  console.log('  --dry-run                Gather counts only; do not write SQLite file');
  console.log('  --include-pg-dump        Also emit a raw pg_dump snapshot (default: true)');
  console.log('  --no-include-pg-dump     Disable raw pg_dump snapshot');
  console.log('  --pg-dump-output <path>  Raw pg_dump output path');
  console.log('  --pg-dump-path <path>    Explicit path to pg_dump executable');
  console.log('  --neon-url <url>         Override NEON_CONNECTION_STRING/DATABASE_URL');
  console.log('  --help                   Show this help text');
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseOptions(): ScriptOptions {
  const timestamp = getTimestamp();
  const defaultOutput = path.resolve(process.cwd(), 'backups', `neon-export-${timestamp}.sqlite`);
  const defaultManifest = path.resolve(
    process.cwd(),
    'backups',
    `neon-export-${timestamp}.manifest.json`,
  );
  const defaultPgDump = path.resolve(
    process.cwd(),
    'backups',
    `neon-export-${timestamp}.pgdump.sql`,
  );

  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      manifest: { type: 'string' },
      schema: { type: 'string', default: 'public' },
      tables: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'include-pg-dump': { type: 'boolean', default: true },
      'no-include-pg-dump': { type: 'boolean', default: false },
      'pg-dump-output': { type: 'string' },
      'pg-dump-path': { type: 'string' },
      'neon-url': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const neonUrl =
    values['neon-url'] || process.env.NEON_CONNECTION_STRING || process.env.DATABASE_URL;
  if (!neonUrl) {
    console.error(
      'Error: missing Neon connection string. Set NEON_CONNECTION_STRING or pass --neon-url.',
    );
    process.exit(1);
  }

  const includePgDump = values['no-include-pg-dump'] ? false : values['include-pg-dump'];
  const tableList = values.tables
    ? values.tables
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

  return {
    output: path.resolve(values.output || defaultOutput),
    manifest: path.resolve(values.manifest || defaultManifest),
    schema: values.schema,
    dryRun: values['dry-run'],
    includePgDump,
    pgDumpOutput: path.resolve(values['pg-dump-output'] || defaultPgDump),
    pgDumpPath: values['pg-dump-path'] || process.env.PG_DUMP_PATH,
    tables: tableList,
    neonUrl,
  };
}

function normalizeNeonConnectionString(rawUrl: string): string {
  const lowered = rawUrl.toLowerCase();
  if (!lowered.includes('sslmode=')) {
    return rawUrl;
  }

  return rawUrl.replace(/sslmode=(require|prefer|verify-ca)/i, 'sslmode=verify-full');
}

function ensureDirFor(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function mapPostgresTypeToSqliteAffinity(dataType: string, udtName: string): string {
  const normalized = `${dataType} ${udtName}`.toLowerCase();

  if (
    normalized.includes('int') ||
    normalized.includes('serial') ||
    normalized.includes('bool') ||
    normalized.includes('bigint')
  ) {
    return 'INTEGER';
  }

  if (
    normalized.includes('numeric') ||
    normalized.includes('decimal') ||
    normalized.includes('real') ||
    normalized.includes('double') ||
    normalized.includes('float')
  ) {
    return 'REAL';
  }

  if (
    normalized.includes('bytea') ||
    normalized.includes('blob')
  ) {
    return 'BLOB';
  }

  if (normalized.includes('json') || normalized.includes('jsonb')) {
    return 'TEXT';
  }

  return 'TEXT';
}

function toSqliteValue(value: unknown): Primitive | Buffer {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    // Preserve precision by converting to string
    return value.toString();
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value as Primitive;
}

async function listTables(pool: Pool, schema: string, filter?: string[]): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
     ORDER BY table_name ASC`,
    [schema],
  );
  const rows = result.rows;

  if (!filter || filter.length === 0) {
    return rows.map((r) => r.table_name);
  }

  const allowed = new Set(filter);
  return rows.map((r) => r.table_name).filter((t) => allowed.has(t));
}

async function listColumns(pool: Pool, schema: string, tableName: string): Promise<TableColumn[]> {
  const result = await pool.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: 'YES' | 'NO';
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY ordinal_position ASC`,
    [schema, tableName],
  );
  const rows = result.rows;

  return rows.map((r) => ({
    columnName: r.column_name,
    dataType: r.data_type,
    udtName: r.udt_name,
    isNullable: r.is_nullable === 'YES',
  }));
}

async function listPrimaryKeyColumns(
  pool: Pool,
  schema: string,
  tableName: string,
): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [schema, tableName],
  );
  const rows = result.rows;

  return rows.map((r) => r.column_name);
}

async function countSourceRows(pool: Pool, schema: string, tableName: string): Promise<number> {
  const sql = `SELECT COUNT(*)::int AS count FROM ${quoteIdent(schema)}.${quoteIdent(tableName)}`;
  const result = await pool.query<{ count: number }>(sql);
  return result.rows[0]?.count ?? 0;
}

async function fetchTableRows(
  pool: Pool,
  schema: string,
  tableName: string,
  columns: TableColumn[],
): Promise<Record<string, unknown>[]> {
  const selectList = columns.map((c) => quoteIdent(c.columnName)).join(', ');
  const sql = `SELECT ${selectList} FROM ${quoteIdent(schema)}.${quoteIdent(tableName)}`;
  const result = await pool.query<Record<string, unknown>>(sql);
  return result.rows;
}

function createSqliteTable(
  db: Database.Database,
  tableName: string,
  columns: TableColumn[],
  primaryKeys: string[],
): void {
  const columnDefs = columns.map((col) => {
    const affinity = mapPostgresTypeToSqliteAffinity(col.dataType, col.udtName);
    const nullable = col.isNullable ? '' : ' NOT NULL';
    return `${quoteIdent(col.columnName)} ${affinity}${nullable}`;
  });

  const pkClause =
    primaryKeys.length > 0 ? `, PRIMARY KEY (${primaryKeys.map(quoteIdent).join(', ')})` : '';

  const createSql = `CREATE TABLE ${quoteIdent(tableName)} (${columnDefs.join(', ')}${pkClause})`;
  db.prepare(createSql).run();
}

function insertRows(
  db: Database.Database,
  tableName: string,
  columns: TableColumn[],
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) {
    return;
  }

  const quotedColumns = columns.map((c) => quoteIdent(c.columnName)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT INTO ${quoteIdent(tableName)} (${quotedColumns}) VALUES (${placeholders})`;
  const insertStmt = db.prepare(insertSql);

  const transaction = db.transaction((tableRows: Record<string, unknown>[]) => {
    for (const row of tableRows) {
      const values = columns.map((col) => toSqliteValue(row[col.columnName]));
      insertStmt.run(values);
    }
  });

  transaction(rows);
}

function maybeRunPgDump(options: ScriptOptions): string | undefined {
  if (!options.includePgDump) {
    return undefined;
  }

  ensureDirFor(options.pgDumpOutput);

  const candidates = [
    options.pgDumpPath,
    'pg_dump',
    'pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
  ].filter((x): x is string => Boolean(x));

  const args = [
    `--dbname=${options.neonUrl}`,
    '--format=plain',
    '--inserts',
    '--column-inserts',
    '--no-owner',
    '--no-privileges',
    '--file',
    options.pgDumpOutput,
  ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      execFileSync(candidate, args, { stdio: 'ignore' });
      return options.pgDumpOutput;
    } catch {
      continue;
    }
  }

  console.warn(
    'Warning: pg_dump was not executed. Add pg_dump to PATH or pass --pg-dump-path "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe".',
  );
  return undefined;
}

async function run(): Promise<void> {
  const options = parseOptions();
  const normalizedNeonUrl = normalizeNeonConnectionString(options.neonUrl);
  const pool = new Pool({
    connectionString: normalizedNeonUrl,
  });

  let sqliteDb: Database.Database | null = null;

  try {
    const tables = await listTables(pool, options.schema, options.tables);
    if (tables.length === 0) {
      throw new Error('No tables found to export. Check schema name and --tables filter.');
    }

    console.log(`Found ${tables.length} tables in schema "${options.schema}".`);

    const manifest: ExportManifest = {
      generatedAt: new Date().toISOString(),
      source: {
        provider: 'neon-postgresql',
        schema: options.schema,
        tableCount: tables.length,
        tables,
      },
      destination: {
        sqlitePath: options.dryRun ? undefined : options.output,
        dryRun: options.dryRun,
        manifestPath: options.manifest,
      },
      integrity: {
        tablesVerified: 0,
        rowsVerified: 0,
        mismatches: [],
      },
      tables: [],
    };

    const pgDumpPath = maybeRunPgDump(options);
    if (pgDumpPath) {
      manifest.destination.pgDumpPath = pgDumpPath;
    }

    if (!options.dryRun) {
      ensureDirFor(options.output);
      if (fs.existsSync(options.output)) {
        fs.unlinkSync(options.output);
      }

      sqliteDb = new Database(options.output);
      sqliteDb.pragma('journal_mode = WAL');
      sqliteDb.pragma('foreign_keys = OFF');
    }

    for (const tableName of tables) {
      console.log(`Exporting table: ${tableName}`);

      try {
        const columns = await listColumns(pool, options.schema, tableName);
        if (columns.length === 0) {
          manifest.tables.push({
            tableName,
            columns: 0,
            sourceRows: 0,
            sqliteRows: 0,
            status: 'skipped',
            message: 'No columns found',
          });
          continue;
        }

        const sourceRows = await countSourceRows(pool, options.schema, tableName);
        let sqliteRows = 0;

        if (!options.dryRun && sqliteDb) {
          const primaryKeys = await listPrimaryKeyColumns(pool, options.schema, tableName);
          createSqliteTable(sqliteDb, tableName, columns, primaryKeys);

          if (sourceRows > 0) {
            const rows = await fetchTableRows(pool, options.schema, tableName, columns);
            insertRows(sqliteDb, tableName, columns, rows);
          }

          sqliteRows = Number(
            (
              sqliteDb.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(tableName)}`).get() as {
                count: number;
              }
            ).count,
          );

          if (sqliteRows !== sourceRows) {
            manifest.integrity.mismatches.push({ tableName, sourceRows, sqliteRows });
          }
        } else {
          sqliteRows = sourceRows;
        }

        manifest.integrity.tablesVerified += 1;
        manifest.integrity.rowsVerified += sourceRows;

        manifest.tables.push({
          tableName,
          columns: columns.length,
          sourceRows,
          sqliteRows,
          status: 'ok',
        });
      } catch (error) {
        manifest.tables.push({
          tableName,
          columns: 0,
          sourceRows: 0,
          sqliteRows: 0,
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    ensureDirFor(options.manifest);
    fs.writeFileSync(options.manifest, JSON.stringify(manifest, null, 2));

    const errorTables = manifest.tables.filter((t) => t.status === 'error');
    if (errorTables.length > 0) {
      console.error(
        `Export finished with ${errorTables.length} table errors. See manifest: ${options.manifest}`,
      );
      process.exitCode = 1;
    }

    if (manifest.integrity.mismatches.length > 0) {
      console.error('Integrity mismatch detected between source and SQLite row counts.');
      console.error(`Manifest: ${options.manifest}`);
      process.exitCode = 1;
    }

    const totalRows = manifest.tables.reduce((sum, t) => sum + t.sourceRows, 0);
    console.log('');
    console.log('Export complete.');
    console.log(`  Dry run: ${options.dryRun ? 'yes' : 'no'}`);
    console.log(`  Tables processed: ${manifest.tables.length}`);
    console.log(`  Source rows: ${totalRows}`);
    if (!options.dryRun) {
      console.log(`  SQLite output: ${options.output}`);
    }
    if (manifest.destination.pgDumpPath) {
      console.log(`  pg_dump snapshot: ${manifest.destination.pgDumpPath}`);
    }
    console.log(`  Manifest: ${options.manifest}`);
  } finally {
    if (sqliteDb) {
      sqliteDb.close();
    }
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Fatal export error:', error);
  process.exit(1);
});

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyPendingMigrations,
  formatMigrationError,
  loadMigrationHistory,
  MigrationExecutionError,
  validateMigrationTarget,
  type MigrationClient,
  type MigrationManifest,
} from './runner';

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);

async function createHistory(manifest: MigrationManifest): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'migration-history-'));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));

  for (const migration of manifest.migrations) {
    await writeFile(path.join(directory, migration.forward), `SELECT '${migration.id}';\n`);
    await writeFile(
      path.join(directory, migration.recovery.file),
      `SELECT 'undo-${migration.id}';\n`,
    );
  }

  return directory;
}

function manifest(ids: string[]): MigrationManifest {
  return {
    version: 1,
    migrations: ids.map((id) => ({
      id,
      forward: `${id}_example.up.sql`,
      transaction: 'required',
      compatibility: 'expand',
      dataLoss: 'none',
      recovery: {
        strategy: 'rollback-sql',
        file: `${id}_example.down.sql`,
        execution: 'manual-only',
        dataLoss: 'destructive',
        completeness: 'complete',
      },
    })),
  };
}

test('loads ordered migration pairs and calculates stable checksums', async () => {
  const directory = await createHistory(manifest(['0001', '0002']));

  const firstLoad = await loadMigrationHistory(directory);
  const secondLoad = await loadMigrationHistory(directory);

  assert.deepEqual(
    firstLoad.map(({ id }) => id),
    ['0001', '0002'],
  );
  assert.match(firstLoad[0].checksum, /^[a-f0-9]{64}$/);
  assert.equal(firstLoad[0].checksum, secondLoad[0].checksum);
});

test('loads the relocated authoritative repository history', async () => {
  const history = await loadMigrationHistory(path.resolve('database/migrations'));

  assert.deepEqual(
    history.map(({ id }) => id),
    ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009'],
  );
  assert.equal(
    history.every(({ recovery }) => recovery.execution === 'manual-only'),
    true,
  );
});

test('rejects duplicate or out-of-order migration identities', async () => {
  const duplicateDirectory = await createHistory(manifest(['0001', '0001']));
  await assert.rejects(loadMigrationHistory(duplicateDirectory), /strictly increasing and unique/);

  const unorderedDirectory = await createHistory(manifest(['0002', '0001']));
  await assert.rejects(
    loadMigrationHistory(unorderedDirectory),
    /strictly increasing and unique|contiguous/,
  );

  const gapDirectory = await createHistory(manifest(['0001', '0003']));
  await assert.rejects(loadMigrationHistory(gapDirectory), /contiguous/);
});

test('rejects a migration whose declared recovery file is missing', async () => {
  const history = manifest(['0001']);
  const directory = await mkdtemp(path.join(tmpdir(), 'migration-history-'));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(history));
  await writeFile(path.join(directory, history.migrations[0].forward), 'SELECT 1;\n');

  await assert.rejects(loadMigrationHistory(directory), /recovery file does not exist/);
});

test('rejects SQL files that are not declared in the authoritative manifest', async () => {
  const directory = await createHistory(manifest(['0001']));
  await writeFile(path.join(directory, '0002_orphan.up.sql'), 'SELECT 2;\n');

  await assert.rejects(loadMigrationHistory(directory), /SQL files are missing from manifest/);
});

class RecordingClient implements MigrationClient {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  appliedRows: Array<{ id: string; checksum: string; state?: string }> = [];

  async query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, values });

    if (text.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: true }] };
    }
    if (text.includes('pg_advisory_unlock')) {
      return { rows: [{ unlocked: true }] };
    }

    if (text.includes('FROM schema_migrations ORDER BY id')) {
      return { rows: this.appliedRows };
    }

    return { rows: [] };
  }
}

test('applies transactional DDL and its ledger record atomically under an advisory lock', async () => {
  const directory = await createHistory(manifest(['0001']));
  const migrations = await loadMigrationHistory(directory);
  const client = new RecordingClient();

  const result = await applyPendingMigrations(client, migrations, {
    deploymentSha: TEST_DEPLOYMENT_SHA,
  });
  const statements = client.calls.map(({ text }) => text);

  assert.deepEqual(result, { applied: ['0001'], alreadyApplied: [] });
  assert.ok(statements.some((text) => text.includes('pg_try_advisory_lock')));
  assert.ok(
    statements.some((text) => text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')),
  );
  assert.ok(statements.includes('BEGIN'));
  assert.ok(
    client.calls.findIndex(
      ({ text, values }) =>
        text.includes('INSERT INTO schema_migrations') && values?.[2] === 'applying',
    ) < client.calls.findIndex(({ text }) => text === migrations[0].sql),
  );
  assert.ok(statements.includes(migrations[0].sql));
  assert.ok(
    client.calls.some(
      ({ text, values }) =>
        text.includes('INSERT INTO schema_migrations') &&
        values?.[0] === '0001' &&
        values?.[1] === migrations[0].checksum,
    ),
  );
  assert.ok(statements.includes('COMMIT'));
  assert.ok(statements.some((text) => text.includes('pg_advisory_unlock')));
});

test('refuses checksum drift before applying any pending migration', async () => {
  const directory = await createHistory(manifest(['0001', '0002']));
  const migrations = await loadMigrationHistory(directory);
  const client = new RecordingClient();
  client.appliedRows = [{ id: '0001', checksum: 'changed-history' }];

  await assert.rejects(
    applyPendingMigrations(client, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
    /checksum mismatch/,
  );
  assert.equal(
    client.calls.some(({ text }) => text === migrations[1].sql),
    false,
  );
});

test('refuses concurrent execution when the advisory lock is unavailable', async () => {
  const directory = await createHistory(manifest(['0001']));
  const migrations = await loadMigrationHistory(directory);
  const client = new RecordingClient();
  client.query = async (text: string, values?: readonly unknown[]) => {
    client.calls.push({ text, values });
    if (text.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: false }] };
    }
    return { rows: [] };
  };

  await assert.rejects(
    applyPendingMigrations(client, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
    /another migration process/,
  );
  assert.equal(
    client.calls.some(({ text }) => text === migrations[0].sql),
    false,
  );
});

test('rolls back transactional DDL when the migration fails', async () => {
  const directory = await createHistory(manifest(['0001']));
  const migrations = await loadMigrationHistory(directory);
  const client = new RecordingClient();
  const baseQuery = client.query.bind(client);
  client.query = async (text: string, values?: readonly unknown[]) => {
    if (text === migrations[0].sql) {
      client.calls.push({ text, values });
      throw new Error('DDL failed');
    }
    return baseQuery(text, values);
  };

  await assert.rejects(
    applyPendingMigrations(client, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
    /DDL failed/,
  );
  assert.ok(client.calls.some(({ text }) => text === 'ROLLBACK'));
  assert.ok(client.calls.some(({ text }) => text.includes('pg_advisory_unlock')));
});

test('leaves an interrupted non-transactional migration in repair-required state', async () => {
  const history = manifest(['0001']);
  history.migrations[0].transaction = 'forbidden';
  const directory = await createHistory(history);
  const migrations = await loadMigrationHistory(directory);
  const client = new RecordingClient();
  const baseQuery = client.query.bind(client);
  client.query = async (text: string, values?: readonly unknown[]) => {
    if (text === migrations[0].sql) {
      client.calls.push({ text, values });
      throw new Error('non-transactional DDL failed');
    }
    return baseQuery(text, values);
  };

  await assert.rejects(
    applyPendingMigrations(client, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
    /non-transactional DDL failed/,
  );
  assert.ok(
    client.calls.some(
      ({ text, values }) =>
        text.includes('INSERT INTO schema_migrations') && values?.[2] === 'applying',
    ),
  );
  assert.equal(
    client.calls.some(({ text }) => text === 'BEGIN'),
    false,
  );
});

test('rejects malformed manifest entries and unknown metadata fields', async () => {
  const directory = await createHistory(manifest(['0001']));
  const malformed = manifest(['0001']) as unknown as {
    version: number;
    migrations: Array<Record<string, unknown>>;
  };
  malformed.migrations[0].unexpected = true;
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(malformed));

  await assert.rejects(loadMigrationHistory(directory), /unknown field/);
});

test('rejects unknown, interrupted, and non-contiguous ledger histories', async () => {
  const directory = await createHistory(manifest(['0001', '0002']));
  const migrations = await loadMigrationHistory(directory);

  for (const [rows, expected] of [
    [[{ id: '9999', checksum: 'x', state: 'applied' }], /absent from authoritative history/],
    [[{ id: '0001', checksum: migrations[0].checksum, state: 'applying' }], /repair it explicitly/],
    [
      [{ id: '0002', checksum: migrations[1].checksum, state: 'applied' }],
      /not a contiguous prefix/,
    ],
  ] as const) {
    const client = new RecordingClient();
    client.appliedRows = [...rows];
    await assert.rejects(
      applyPendingMigrations(client, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
      expected,
    );
  }
});

test('includes recovery SQL and metadata in checksum drift detection', async () => {
  const directory = await createHistory(manifest(['0001']));
  const before = await loadMigrationHistory(directory);
  await writeFile(path.join(directory, '0001_example.down.sql'), 'SELECT different_recovery;\n');
  const after = await loadMigrationHistory(directory);

  assert.notEqual(before[0].checksum, after[0].checksum);
});

test('preserves the migration failure when rollback and unlock also fail', async () => {
  const directory = await createHistory(manifest(['0001']));
  const migrations = await loadMigrationHistory(directory);
  const client = new RecordingClient();
  const baseQuery = client.query.bind(client);
  client.query = async (text: string, values?: readonly unknown[]) => {
    if (text === migrations[0].sql) throw new Error('primary DDL failure');
    if (text === 'ROLLBACK') throw new Error('rollback failure');
    if (text.includes('pg_advisory_unlock')) throw new Error('unlock failure');
    return baseQuery(text, values);
  };

  await assert.rejects(
    applyPendingMigrations(client, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
    (error: unknown) =>
      error instanceof MigrationExecutionError &&
      error.errors.some(
        (item) => item instanceof Error && item.message === 'primary DDL failure',
      ) &&
      error.errors.some((item) => item instanceof Error && item.message === 'rollback failure') &&
      error.errors.some((item) => item instanceof Error && item.message === 'unlock failure'),
  );
});

test('requires an allowlisted target and explicit production confirmation', () => {
  const connectionString = 'postgresql://user:secret@ep-example.neon.tech/app';

  assert.throws(
    () =>
      validateMigrationTarget(connectionString, {
        allowedHost: 'ep-example.neon.tech',
        allowedDatabase: 'app',
      }),
    /environment must be one of/,
  );
  assert.throws(
    () =>
      validateMigrationTarget(connectionString, {
        allowedHost: 'ep-other.neon.tech',
        allowedDatabase: 'app',
        environment: 'development',
      }),
    /does not match the allowlist/,
  );
  assert.throws(
    () =>
      validateMigrationTarget(connectionString, {
        allowedHost: 'ep-example.neon.tech',
        allowedDatabase: 'app',
        environment: 'production',
      }),
    /production confirmation/,
  );

  const target = validateMigrationTarget(connectionString, {
    allowedHost: 'ep-example.neon.tech',
    allowedDatabase: 'app',
    environment: 'production',
    productionConfirmation: 'APPLY ep-example.neon.tech/app',
  });
  assert.deepEqual(target, { host: 'ep-example.neon.tech', database: 'app' });
});

test('rejects invalid deployment identities and a false advisory unlock result', async () => {
  const directory = await createHistory(manifest(['0001']));
  const migrations = await loadMigrationHistory(directory);
  const invalidShaClient = new RecordingClient();

  await assert.rejects(
    applyPendingMigrations(invalidShaClient, migrations, { deploymentSha: 'not-a-sha' }),
    /valid Git commit SHA/,
  );

  const unlockClient = new RecordingClient();
  const baseQuery = unlockClient.query.bind(unlockClient);
  unlockClient.query = async (text: string, values?: readonly unknown[]) => {
    if (text.includes('pg_advisory_unlock')) {
      unlockClient.calls.push({ text, values });
      return { rows: [{ unlocked: false }] };
    }
    return baseQuery(text, values);
  };
  await assert.rejects(
    applyPendingMigrations(unlockClient, migrations, { deploymentSha: TEST_DEPLOYMENT_SHA }),
    /advisory unlock failed/,
  );
});

test('recursively reports and redacts nested migration and connection-close failures', () => {
  const nested = new MigrationExecutionError('migration and close failed', [
    new MigrationExecutionError('DDL and rollback failed', [
      new Error('DDL failed for postgresql://user:secret@host/db'),
      new Error('rollback password=secret'),
    ]),
    new Error('connection close failed'),
  ]);

  const formatted = formatMigrationError(nested);
  assert.match(formatted, /DDL failed/);
  assert.match(formatted, /rollback/);
  assert.match(formatted, /connection close failed/);
  assert.doesNotMatch(formatted, /user:secret/);
  assert.doesNotMatch(formatted, /password=secret/);
});

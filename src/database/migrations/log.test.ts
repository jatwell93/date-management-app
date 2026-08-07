/**
 * Phase 1 task 1.10 (part B) — structured migration event logging tests.
 *
 * Covers `emitMigrationEvent` (single JSON line on stdout with exactly the
 * required fields), `classifyMigrationError` mapping for every code including
 * the `execution-failure` fallback and `MigrationExecutionError` unwrapping,
 * the `resolveDeploymentSha` fallback chain, and password redaction. Stdout is
 * captured by temporarily replacing `console.log`, matching the pure-function
 * style of `commands.test.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { emitMigrationEvent, resolveDeploymentSha, type MigrationEvent } from './log';
import { MigrationCodedError, MigrationExecutionError, type MigrationErrorCode } from './runner';

// ---------------------------------------------------------------------------
// stdout capture helper
// ---------------------------------------------------------------------------

function emitAndRead(event: MigrationEvent): Record<string, unknown> {
  const original = console.log;
  let captured: string | undefined;
  console.log = (message: string) => {
    captured = message;
  };
  try {
    emitMigrationEvent(event);
  } finally {
    console.log = original;
  }
  assert.ok(captured !== undefined, 'emitMigrationEvent did not write to console.log');
  return JSON.parse(captured) as Record<string, unknown>;
}

const BASE_EVENT: Omit<MigrationEvent, 'command' | 'phase' | 'error'> = {
  migrationId: '0003',
  host: 'db.example.com',
  database: 'appdb',
  environment: 'staging',
  deploymentSha: 'abc1234',
  durationMs: 42,
};

// ===========================================================================
// Tests: emitMigrationEvent — JSON shape and required fields
// ===========================================================================

test('emitMigrationEvent writes a single JSON line with exactly the required fields', () => {
  const line = emitAndRead({ ...BASE_EVENT, command: 'apply', phase: 'success' });
  assert.deepEqual(Object.keys(line).sort(), [
    'command',
    'database',
    'deploymentSha',
    'durationMs',
    'environment',
    'errorClass',
    'host',
    'message',
    'migrationId',
    'phase',
    'ts',
  ]);
  assert.equal(line.command, 'apply');
  assert.equal(line.phase, 'success');
  assert.equal(line.migrationId, '0003');
  assert.equal(line.host, 'db.example.com');
  assert.equal(line.database, 'appdb');
  assert.equal(line.environment, 'staging');
  assert.equal(line.deploymentSha, 'abc1234');
  assert.equal(line.durationMs, 42);
  assert.equal(line.errorClass, null);
  assert.equal(line.message, null);
  assert.equal(typeof line.ts, 'string');
  assert.ok(!Number.isNaN(Date.parse(line.ts as string)));
});

test('emitMigrationEvent honours an explicit ts when provided', () => {
  const line = emitAndRead({
    ...BASE_EVENT,
    command: 'status',
    phase: 'start',
    ts: '2026-08-07T12:00:00.000Z',
  });
  assert.equal(line.ts, '2026-08-07T12:00:00.000Z');
});

test('emitMigrationEvent accepts a null migrationId', () => {
  const line = emitAndRead({
    ...BASE_EVENT,
    command: 'preflight',
    phase: 'start',
    migrationId: null,
  });
  assert.equal(line.migrationId, null);
});

// ===========================================================================
// Tests: error classification — every code, fallback, and unwrapping
// ===========================================================================

test('each MigrationErrorCode is classified correctly from a coded error', () => {
  const codes: MigrationErrorCode[] = [
    'lock-unavailable',
    'checksum-mismatch',
    'ledger-inconsistent',
    'target-rejected',
    'catalog-drift',
    'execution-failure',
  ];
  for (const code of codes) {
    const line = emitAndRead({
      ...BASE_EVENT,
      command: 'apply',
      phase: 'failure',
      error: new MigrationCodedError(`boom ${code}`, code),
    });
    assert.equal(line.errorClass, code, `expected code ${code}`);
  }
});

test('a plain Error falls back to execution-failure and carries its message', () => {
  const line = emitAndRead({
    ...BASE_EVENT,
    command: 'apply',
    phase: 'failure',
    error: new Error('something broke'),
  });
  assert.equal(line.errorClass, 'execution-failure');
  assert.equal(line.message, 'something broke');
});

test('a MigrationExecutionError wrapping a coded error is unwrapped to the inner code', () => {
  const inner = new MigrationCodedError('checksum mismatch inner', 'checksum-mismatch');
  const wrapped = new MigrationExecutionError('migration failed', [
    inner,
    new Error('rollback also failed'),
  ]);
  const line = emitAndRead({
    ...BASE_EVENT,
    command: 'apply',
    phase: 'failure',
    error: wrapped,
  });
  assert.equal(line.errorClass, 'checksum-mismatch');
});

test('a MigrationExecutionError with no coded cause falls back to execution-failure', () => {
  const wrapped = new MigrationExecutionError('migration failed', [new Error('plain cause')]);
  const line = emitAndRead({
    ...BASE_EVENT,
    command: 'apply',
    phase: 'failure',
    error: wrapped,
  });
  assert.equal(line.errorClass, 'execution-failure');
});

// ===========================================================================
// Tests: resolveDeploymentSha — fallback chain
// ===========================================================================

test('resolveDeploymentSha prefers MIGRATION_DEPLOYMENT_SHA over GITHUB_SHA', () => {
  assert.equal(
    resolveDeploymentSha({ MIGRATION_DEPLOYMENT_SHA: 'deploy-1', GITHUB_SHA: 'gh-1' }),
    'deploy-1',
  );
});

test('resolveDeploymentSha falls back to GITHUB_SHA when no deploy override is set', () => {
  assert.equal(resolveDeploymentSha({ GITHUB_SHA: 'gh-2' }), 'gh-2');
});

test('resolveDeploymentSha returns unknown when neither variable is set', () => {
  assert.equal(resolveDeploymentSha({}), 'unknown');
});

// ===========================================================================
// Tests: message redaction — secrets never reach stdout
// ===========================================================================

test('an error message embedding a postgresql password is redacted and never emits the secret', () => {
  const line = emitAndRead({
    ...BASE_EVENT,
    command: 'apply',
    phase: 'failure',
    error: new Error('connection failed: postgresql://user:hunter2@host/db'),
  });
  const serialized = JSON.stringify(line);
  assert.ok(!serialized.includes('hunter2'), 'password leaked into the log line');
  assert.match(line.message as string, /\[redacted\]@/);
});

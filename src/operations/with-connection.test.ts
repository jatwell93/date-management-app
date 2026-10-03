import assert from 'node:assert/strict';
import test from 'node:test';

import { MigrationExecutionError } from '../database/migrations/runner';
import { withConnection } from './with-connection';

function fakeConnection(endError?: Error) {
  const calls: string[] = [];
  return {
    calls,
    async connect() {
      calls.push('connect');
    },
    async end() {
      calls.push('end');
      if (endError) throw endError;
    },
  };
}

test('connects, returns the work result, and closes', async () => {
  const connection = fakeConnection();

  const value = await withConnection(connection, 'Seed', async (c) => {
    c.calls.push('work');
    return 42;
  });

  assert.equal(value, 42);
  assert.deepEqual(connection.calls, ['connect', 'work', 'end']);
});

test('closes and rethrows the original error when the work fails', async () => {
  const connection = fakeConnection();
  const failure = new Error('work failed');

  await assert.rejects(
    () =>
      withConnection(connection, 'Seed', async () => {
        throw failure;
      }),
    (error: unknown) => error === failure,
  );
  assert.deepEqual(connection.calls, ['connect', 'end']);
});

test('reports both errors when the work and the close fail', async () => {
  const closeFailure = new Error('close failed');
  const connection = fakeConnection(closeFailure);
  const failure = new Error('work failed');

  await assert.rejects(
    () =>
      withConnection(connection, 'Seed', async () => {
        throw failure;
      }),
    (error: unknown) => {
      assert.ok(error instanceof MigrationExecutionError);
      assert.equal(error.message, 'Seed failed and connection close also failed');
      assert.deepEqual(error.errors, [failure, closeFailure]);
      return true;
    },
  );
});

test('surfaces a failed close when the work itself succeeded', async () => {
  const closeFailure = new Error('close failed');
  const connection = fakeConnection(closeFailure);

  await assert.rejects(
    () => withConnection(connection, 'Seed', async () => 'done'),
    (error: unknown) => error === closeFailure,
  );
});

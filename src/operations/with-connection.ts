/**
 * Connection lifecycle shared by the operator CLIs in this directory.
 *
 * Each CLI connects, does its work, and must close the connection whether the
 * work succeeded or not — and if both the work and the close fail, the close
 * error must not replace the one that explains what went wrong. That is the
 * sequence `src/database/migrations/seed-cli.ts` spells out inline; it lives
 * here once so the CLIs cannot each get it subtly different.
 */
import { MigrationExecutionError } from '../database/migrations/runner';

export interface Connection {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
}

/**
 * Connects, runs `work`, and always closes. Returns what `work` returned or
 * rethrows what it threw; a failed close after failed work raises both.
 */
export async function withConnection<C extends Connection, T>(
  connection: C,
  label: string,
  work: (connection: C) => Promise<T>,
): Promise<T> {
  await connection.connect();

  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await work(connection) };
  } catch (error) {
    outcome = { error };
  }

  try {
    await connection.end();
  } catch (closeError) {
    if ('error' in outcome) {
      throw new MigrationExecutionError(`${label} failed and connection close also failed`, [
        outcome.error,
        closeError,
      ]);
    }
    throw closeError;
  }

  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

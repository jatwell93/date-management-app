/**
 * Shared database connection-string resolution for Workers handlers.
 *
 * Prefers the direct Neon connection string, then a generic DATABASE_URL,
 * and only falls back to Hyperdrive last. Hyperdrive-first ordering caused
 * bootstrap failures (NeonDbError 530/1016) when Hyperdrive was misconfigured,
 * so all handlers must share this single ordering to stay consistent with
 * `createWorkersDatabase` in `database.ts`.
 */
import type { Env } from '../types/env';

export function getConnectionString(env: Env): string {
  return env.NEON_CONNECTION_STRING || env.DATABASE_URL || env.HYPERDRIVE?.connectionString || '';
}

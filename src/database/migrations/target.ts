/**
 * Phase 1 task 1.5 — extended target guards for the ordered migration commands.
 *
 * `validateMigrationTarget` (in runner.ts) handles the pure, connection-string
 * level checks: pooled-hostname rejection, host/database allowlist, environment,
 * and production confirmation. The task 1.5 guards that require either an
 * explicit operator declaration or a live database session live here so the
 * pure function and its existing unit tests stay unchanged.
 *
 *   assertTargetKind     — pure: validates MIGRATION_TARGET_KIND and rejects
 *                          development/restore targets for mutating commands.
 *   verifyMigrationRole  — async: queries `current_user` and rejects when the
 *                          connected role is not the dedicated DDL migration
 *                          role declared via MIGRATION_ROLE.
 *
 * Both are composed into the status/preflight/apply/seed/verify CLIs alongside
 * `validateMigrationTarget`. Mutating commands (apply, seed) reject non-primary
 * target kinds; read-only commands (status, preflight, verify) accept any
 * declared kind so an operator can preflight or verify a restore-drill branch.
 */
import type { MigrationClient } from './runner';

export type TargetKind = 'primary' | 'development' | 'restore-drill';

const VALID_TARGET_KINDS: readonly TargetKind[] = ['primary', 'development', 'restore-drill'];

export interface TargetKindOptions {
  /** Declared target kind from MIGRATION_TARGET_KIND. Required for all commands. */
  targetKind?: string;
  /** Whether the command mutates schema or reference data. */
  mutating: boolean;
}

/**
 * Validates the declared target kind and rejects development/restore targets
 * for mutating commands (apply, seed). Read-only commands may run against any
 * declared kind so an operator can preflight or verify a restore-drill branch.
 */
export function assertTargetKind(options: TargetKindOptions): TargetKind {
  const { targetKind, mutating } = options;
  if (!targetKind) {
    throw new Error('MIGRATION_TARGET_KIND is required (primary | development | restore-drill)');
  }
  if (!VALID_TARGET_KINDS.includes(targetKind as TargetKind)) {
    throw new Error(
      `MIGRATION_TARGET_KIND must be one of ${VALID_TARGET_KINDS.join(', ')} (got "${targetKind}")`,
    );
  }
  const kind = targetKind as TargetKind;
  if (mutating && kind !== 'primary') {
    throw new Error(
      `Refusing to run a mutating migration command against a "${kind}" target; ` +
        'only "primary" is allowed for apply/seed',
    );
  }
  return kind;
}

/**
 * Verifies the connected database role matches the dedicated DDL migration
 * role declared via MIGRATION_ROLE. The migration commands must not run as the
 * application/Worker role — DDL privileges belong to a dedicated role so a
 * leaked or reused app credential cannot mutate the schema.
 *
 * Returns the resolved role name for inclusion in command output.
 */
export async function verifyMigrationRole(
  client: MigrationClient,
  expectedRole: string | undefined,
): Promise<string> {
  if (!expectedRole) {
    throw new Error('MIGRATION_ROLE is required (the dedicated DDL migration role)');
  }
  const result = await client.query('SELECT current_user AS role');
  const row = result.rows[0] as { role?: string } | undefined;
  const currentRole = row?.role;
  if (typeof currentRole !== 'string' || currentRole.length === 0) {
    throw new Error('Could not determine the current PostgreSQL role (current_user)');
  }
  if (currentRole !== expectedRole) {
    throw new Error(
      `Connected role "${currentRole}" does not match the required migration role ` +
        `"${expectedRole}"; use the dedicated DDL migration role`,
    );
  }
  return currentRole;
}

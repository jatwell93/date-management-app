/**
 * Structured migration event logging (task 1.10, part B).
 *
 * Emits one JSON object per line to stdout. Alerting is "structured JSON log
 * line + a failing CI job" — no Sentry, no logging library, no new deps.
 *
 * Target identity (`host`/`database`) is the already-redacted pair returned by
 * `validateMigrationTarget` in `runner.ts`; this module never sees a connection
 * string and does not redact. The `message` field is redacted via
 * `formatMigrationError` and `errorClass` via `classifyMigrationError`, both
 * reused from `runner.ts` so no regexes are duplicated.
 */
import { classifyMigrationError, formatMigrationError, type MigrationErrorCode } from './runner';

export type MigrationCommand = 'apply' | 'status' | 'preflight' | 'seed' | 'verify' | 'adopt';
export type MigrationPhase = 'start' | 'success' | 'failure';

export interface MigrationEvent {
  command: MigrationCommand;
  phase: MigrationPhase;
  migrationId: string | null;
  /** Redacted target identity, as returned by `validateMigrationTarget`. */
  host: string;
  /** Redacted target identity, as returned by `validateMigrationTarget`. */
  database: string;
  environment: string;
  deploymentSha: string;
  durationMs: number;
  /**
   * Optional raw error. When present, `errorClass` and `message` are derived
   * from it via `classifyMigrationError` and `formatMigrationError`, overriding
   * any explicit values. This field is never included in the emitted JSON line.
   */
  error?: unknown;
  errorClass?: MigrationErrorCode | null;
  message?: string | null;
  /** ISO 8601 timestamp; defaults to now when omitted. */
  ts?: string;
}

/**
 * Resolve the deployment SHA for log correlation without shelling out to git.
 * Prefers an explicit migration deploy override, then the CI-provided SHA,
 * then a sentinel.
 */
export function resolveDeploymentSha(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.MIGRATION_DEPLOYMENT_SHA ?? env.GITHUB_SHA ?? 'unknown';
}

/**
 * Emit one structured migration event as a JSON line on stdout. The emitted
 * object always contains exactly the fields listed in task 1.10 — the
 * transient `error` input field is consumed for derivation and dropped.
 */
export function emitMigrationEvent(event: MigrationEvent): void {
  const errorClass =
    event.error !== undefined ? classifyMigrationError(event.error) : (event.errorClass ?? null);
  const message =
    event.error !== undefined ? formatMigrationError(event.error) : (event.message ?? null);
  console.log(
    JSON.stringify({
      ts: event.ts ?? new Date().toISOString(),
      command: event.command,
      phase: event.phase,
      migrationId: event.migrationId,
      host: event.host,
      database: event.database,
      environment: event.environment,
      deploymentSha: event.deploymentSha,
      durationMs: event.durationMs,
      errorClass,
      message,
    }),
  );
}

/**
 * Per-invocation context shared by a command's start/success/failure events.
 *
 * Created before the target is validated so that a `validateMigrationTarget`
 * rejection still produces a `failure` event — with `host`/`database` left as
 * `unknown`, since at that point there is no *validated* identity to report and
 * echoing the unvalidated connection string is exactly what must not happen.
 */
export interface MigrationEventContext {
  command: MigrationCommand;
  host: string;
  database: string;
  environment: string;
  deploymentSha: string;
  startedAt: number;
}

export function createEventContext(command: MigrationCommand): MigrationEventContext {
  return {
    command,
    host: 'unknown',
    database: 'unknown',
    environment: process.env.MIGRATION_ENVIRONMENT ?? 'unknown',
    deploymentSha: resolveDeploymentSha(),
    startedAt: Date.now(),
  };
}

/** Record the validated target identity on the context. */
export function setEventTarget(
  context: MigrationEventContext,
  target: { host: string; database: string },
): void {
  context.host = target.host;
  context.database = target.database;
}

function emitPhase(
  context: MigrationEventContext,
  phase: MigrationPhase,
  migrationId: string | null,
  error?: unknown,
): void {
  emitMigrationEvent({
    command: context.command,
    phase,
    migrationId,
    host: context.host,
    database: context.database,
    environment: context.environment,
    deploymentSha: context.deploymentSha,
    durationMs: Date.now() - context.startedAt,
    error,
  });
}

export function emitStart(context: MigrationEventContext, migrationId: string | null = null): void {
  emitPhase(context, 'start', migrationId);
}

export function emitSuccess(
  context: MigrationEventContext,
  migrationId: string | null = null,
): void {
  emitPhase(context, 'success', migrationId);
}

export function emitFailure(
  context: MigrationEventContext,
  error: unknown,
  migrationId: string | null = null,
): void {
  emitPhase(context, 'failure', migrationId, error);
}

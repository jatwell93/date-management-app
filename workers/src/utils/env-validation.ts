import type { Env } from '../types/env';

/**
 * Configuration validation for the Worker.
 *
 * Replaces the fail-fast in `backend/src/config/environment.ts`, which the live
 * Worker has no equivalent of: it declares 36 env keys and trusts every one
 * (2.5 §F).
 *
 * **Why this does not `process.exit(1)`, and why that is not a weaker choice.**
 * Express validated at boot: the process refused to start, an operator saw it
 * in the deploy, and no request was ever served by a misconfigured build. A
 * Worker has no boot phase. The closest equivalent -- throwing at module scope
 * -- makes *every* request 500, including `/health`, which is the one endpoint
 * an operator would reach for to find out what is wrong. It would also convert
 * a single mistyped secret into a total outage, on a repo where a push to main
 * auto-deploys production.
 *
 * So the control is split by blast radius, which the Worker was already doing
 * ad hoc in two places before this module existed: `JWT_SECRET` returns a 500
 * from the API branch of `index-minimal.ts`, and a missing
 * `STRIPE_WEBHOOK_SECRET` makes the Stripe receiver answer 503 and write
 * nothing (3.1.m). This generalizes that pattern rather than replacing it --
 * every key is classified, `/health` reports the whole picture, and only the
 * routes that genuinely need a missing key fail.
 */

/** A key whose absence breaks essentially every authenticated request. */
export interface RequiredConfigCheck {
  /** Name shown to an operator. */
  name: string;
  /** What stops working. */
  impact: string;
  /** True when satisfied. */
  isSatisfied: (env: Env) => boolean;
}

/** A key whose absence disables one feature and leaves the rest working. */
export interface FeatureConfigCheck {
  name: string;
  feature: string;
  isSatisfied: (env: Env) => boolean;
}

/**
 * Note the database entry is a *capability* check, not a key check.
 *
 * `getConnectionString` accepts `NEON_CONNECTION_STRING`, `DATABASE_URL` or
 * `HYPERDRIVE.connectionString` (`utils/db-connection.ts`), so a required-list
 * naming only `NEON_CONNECTION_STRING` would report a Hyperdrive-only
 * deployment as broken while it served traffic perfectly well -- a false alarm
 * that trains operators to ignore this output, which is worse than not having
 * it. Each check therefore asks whether the *capability* is satisfied.
 */
export const REQUIRED_CONFIG: readonly RequiredConfigCheck[] = [
  {
    name: 'NEON_CONNECTION_STRING | DATABASE_URL | HYPERDRIVE',
    impact: 'every database-backed route',
    isSatisfied: (env) =>
      Boolean(
        env.NEON_CONNECTION_STRING?.trim() ||
        env.DATABASE_URL?.trim() ||
        env.HYPERDRIVE?.connectionString?.trim(),
      ),
  },
  {
    name: 'JWT_SECRET',
    impact: 'all authenticated API routes (already enforced per-request)',
    isSatisfied: (env) => Boolean(env.JWT_SECRET?.trim()),
  },
];

export const FEATURE_CONFIG: readonly FeatureConfigCheck[] = [
  {
    name: 'CLERK_SECRET_KEY',
    feature: 'Clerk session verification and organization bootstrap',
    isSatisfied: (env) => Boolean(env.CLERK_SECRET_KEY?.trim()),
  },
  {
    name: 'CLERK_WEBHOOK_SECRET',
    feature: 'inbound Clerk webhooks',
    isSatisfied: (env) => Boolean(env.CLERK_WEBHOOK_SECRET?.trim()),
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    feature: 'inbound Stripe webhooks (receiver answers 503 without it)',
    isSatisfied: (env) => Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
  },
  {
    name: 'CSV_UPLOADS',
    feature: 'file uploads and catalogue import',
    isSatisfied: (env) => Boolean(env.CSV_UPLOADS),
  },
  {
    name: 'RESEND_API_KEY',
    feature: 'supplier credit-claim emails',
    isSatisfied: (env) => Boolean(env.RESEND_API_KEY?.trim()),
  },
];

export interface ConfigValidationResult {
  ok: boolean;
  /** Required capabilities that are absent. Non-empty means the deploy is broken. */
  missingRequired: string[];
  /** Feature keys that are absent. Non-empty is often intentional. */
  missingFeatures: string[];
}

export function validateWorkerConfig(env: Env): ConfigValidationResult {
  const missingRequired = REQUIRED_CONFIG.filter((c) => !c.isSatisfied(env)).map((c) => c.name);
  const missingFeatures = FEATURE_CONFIG.filter((c) => !c.isSatisfied(env)).map((c) => c.name);

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    missingFeatures,
  };
}

/**
 * Human-readable lines for `/health` and for the startup log.
 *
 * Deliberately names the impact rather than only the key, because the audience
 * is an operator reading a health payload at 2am, not the person who wrote the
 * list.
 */
export function describeConfigProblems(env: Env): string[] {
  return [
    ...REQUIRED_CONFIG.filter((c) => !c.isSatisfied(env)).map(
      (c) => `MISSING REQUIRED ${c.name} -- breaks ${c.impact}`,
    ),
    ...FEATURE_CONFIG.filter((c) => !c.isSatisfied(env)).map(
      (c) => `disabled: ${c.feature} (${c.name} not set)`,
    ),
  ];
}

/**
 * Log the configuration picture once per isolate.
 *
 * Once, not per request: a Worker isolate serves many requests, and logging
 * this on each would bury the signal and cost money on a paid logging plan.
 * The flag is module-scoped, so it naturally resets when Cloudflare recycles
 * the isolate -- which is the behaviour wanted, since a new isolate may have
 * picked up new bindings.
 */
let hasLoggedConfig = false;

export function logConfigOnce(env: Env): void {
  if (hasLoggedConfig) {
    return;
  }
  hasLoggedConfig = true;

  const result = validateWorkerConfig(env);
  if (result.ok && result.missingFeatures.length === 0) {
    return;
  }

  const problems = describeConfigProblems(env);
  if (!result.ok) {
    console.error(
      JSON.stringify({
        event: 'worker_config_invalid',
        missingRequired: result.missingRequired,
        missingFeatures: result.missingFeatures,
        problems,
      }),
    );
    return;
  }

  console.warn(
    JSON.stringify({
      event: 'worker_config_features_disabled',
      missingFeatures: result.missingFeatures,
      problems,
    }),
  );
}

/** Test seam: reset the once-per-isolate log flag. */
export function resetConfigLogForTests(): void {
  hasLoggedConfig = false;
}

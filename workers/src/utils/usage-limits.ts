/**
 * Per-tier usage limits for the deployed Worker.
 *
 * Replaces `utils/feature-gates.ts`, deleted in task 3.1.a. That module had no
 * production importer and every one of its branches queried `"Product"`,
 * `"User"`, `"InventoryItem"` or `"Upload"` — Prisma-style table names that do
 * not exist in this schema (`products`, `users`, `inventory_items`, `uploads`),
 * so each threw `relation "Product" does not exist` and failed closed. There
 * was nothing in it to repair.
 *
 * **Limits are enforced by counting rows, not by reading a counter column.**
 * `organization_usage.active_users` is the cautionary tale: it is written as a
 * literal `0` and incremented nowhere in either backend, so every gate reading
 * it compares `0 >= max` and never fires. Express's own limits that work
 * (`max_inventory_items`, and the invite path's user limit at
 * `backend/src/services/organization-invite.service.ts:300`) count live for the
 * same reason. Counting also removes the atomicity problem: the count sits
 * inside the same INSERT that consumes the quota, so check and write cannot be
 * separated by a concurrent request. See the callers in `database.ts`.
 */
import type { Env } from '../types/env';

export type LaunchTier = 'free' | 'starter' | 'professional' | 'enterprise';

/**
 * Catalogue and expiry-list caps. These are the numbers the queued catalogue
 * import already enforces (`upload/catalogue-import.ts:114`, against the
 * `max_skus_snapshot` taken at queue time), and they agree with
 * `TIER_LIMITS.max_skus` / `.max_inventory_items` in
 * `shared/types/subscription.ts`. Interactive creates read the same table so
 * that a SKU rejected by an import is not accepted one-at-a-time through
 * `POST /api/products`.
 */
export const LAUNCH_TIER_LIMITS: Record<
  LaunchTier,
  { maxSkus: number; maxActiveExpiries: number }
> = {
  free: { maxSkus: 500, maxActiveExpiries: 500 },
  starter: { maxSkus: 5000, maxActiveExpiries: 5000 },
  professional: { maxSkus: 50000, maxActiveExpiries: 50000 },
  enterprise: { maxSkus: 250000, maxActiveExpiries: 250000 },
};

/**
 * Seat caps, mirroring `TIER_LIMITS.max_users` in
 * `shared/types/subscription.ts`.
 *
 * **Reported, not enforced.** No seat limit is enforced on either backend:
 * Express's `checkUsageLimit('max_users')` and this Worker's
 * `handleCreateLegacyUser` both compare against
 * `organization_usage.active_users`, which is written as a literal `0` and
 * incremented nowhere in the repo, so both compare `0 >= max` and never fire.
 * Task 3.1.a scoped that out as parity rather than a migration regression; it
 * is recorded in tasks.md as a pre-existing defect. These values exist so the
 * usage endpoint can show a real denominator next to a real count.
 */
export const LAUNCH_TIER_USER_LIMITS: Record<LaunchTier, number> = {
  free: 1,
  starter: 3,
  professional: 10,
  enterprise: 10,
};

const GIBIBYTE = 1024 * 1024 * 1024;

/**
 * Per-tier storage limits (bytes). There is no per-org max_storage column, so
 * these mirror `SUBSCRIPTION_TIERS` in
 * `backend/src/services/storage-quota.service.ts` (free 1GB / pro 10GB /
 * enterprise 1TB), keyed by normalized launch tier.
 *
 * Note a pre-existing disagreement, deliberately NOT resolved here:
 * `TIER_LIMITS.storage_bytes` in `shared/types/subscription.ts` says 100GB for
 * professional and enterprise, and Express's `checkUsageLimit('storage_bytes')`
 * enforces against *that* while Express's own StorageQuotaService reports
 * against the 1/10/1000 line below. Two of the three sources agree on
 * 1/10/1000, and it is what this Worker already reports at
 * `GET /api/organization/usage`, so enforcing against it keeps the Worker
 * self-consistent: the limit a caller is refused against is the limit the
 * dashboard shows them. Changing the entitlement is a product decision.
 */
export const STORAGE_LIMIT_BYTES_BY_TIER: Record<LaunchTier, number> = {
  free: 1 * GIBIBYTE,
  starter: 10 * GIBIBYTE,
  professional: 10 * GIBIBYTE,
  enterprise: 1000 * GIBIBYTE,
};

export function normalizeLaunchTier(value: unknown): LaunchTier {
  const tier = String(value || '')
    .trim()
    .toLowerCase();
  if (tier === 'free') return 'free';
  if (tier === 'starter') return 'starter';
  if (tier === 'professional') return 'professional';
  if (tier === 'enterprise') return 'enterprise';
  if (tier === 'premium') return 'professional';
  if (tier === 'concierge') return 'enterprise';
  return 'free';
}

/**
 * Parse a positive-integer env override, falling back to `fallback` when the
 * value is missing, non-numeric, NaN, or non-positive. Without this guard a
 * misconfigured ENTERPRISE_* var would yield NaN and silently fail every
 * enterprise import (`count <= NaN` is always false).
 */
export function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** SKU cap for a tier, honouring the enterprise-only env override. */
export function resolveMaxSkus(tier: LaunchTier, env: Env): number {
  const fallback = LAUNCH_TIER_LIMITS[tier].maxSkus;
  return tier === 'enterprise' ? parsePositiveIntEnv(env.ENTERPRISE_MAX_SKUS, fallback) : fallback;
}

/** Active-expiry (inventory item) cap for a tier, honouring the env override. */
export function resolveMaxActiveExpiries(tier: LaunchTier, env: Env): number {
  const fallback = LAUNCH_TIER_LIMITS[tier].maxActiveExpiries;
  return tier === 'enterprise'
    ? parsePositiveIntEnv(env.ENTERPRISE_MAX_ACTIVE_EXPIRIES, fallback)
    : fallback;
}

/** Storage cap in bytes for a tier. No env override exists for storage. */
export function resolveStorageLimitBytes(tier: LaunchTier): number {
  return STORAGE_LIMIT_BYTES_BY_TIER[tier];
}

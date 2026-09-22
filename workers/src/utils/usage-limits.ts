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
 * same reason.
 *
 * **Counting narrows the atomicity problem; it does not remove it.** The count
 * sits inside the same INSERT that consumes the quota, so the check can no
 * longer go stale across a network round trip. But PostgreSQL runs each
 * statement under READ COMMITTED with its own snapshot -- and Neon's HTTP
 * driver gives each statement its own implicit transaction -- so two creates
 * racing at limit-1 can both observe room and both insert. **The cap is soft
 * under concurrency**, exceedable by up to the number of in-flight requests.
 *
 * That is the guarantee to rely on when flipping `USAGE_LIMITS_ENFORCE` on: an
 * organization cannot drift far past its tier, but it can sit a few rows over.
 * A hard cap would need SERIALIZABLE, a per-org advisory lock, or a counter row
 * claimed with `UPDATE ... SET used = used + 1 WHERE used < cap` -- the last
 * being genuinely atomic, since an UPDATE re-evaluates its predicate after
 * taking the row lock. Note the irony before reaching for it: a counter is what
 * the dead `organization_usage` columns were, and a counter that is not
 * maintained on every path fails open and silently, which is how the limits
 * came to be unenforced in the first place. Counting is wrong by a bounded
 * amount under load; an unmaintained counter is wrong by everything, always.
 *
 * See the callers in `database.ts`.
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
 * **Enforced by counting live users, as of task 3.1.j(a).** Before that they
 * were reported and not enforced, and the reason is worth keeping: both
 * backends compared against `organization_usage.active_users`, which is
 * written as a literal `0` and incremented nowhere in the repo, so both
 * compared `0 >= max` and never fired. The Worker's copy of that read also
 * took its *denominator* from the same row — `max_users`, seeded as a literal
 * `1` for every organization regardless of tier — so the one way the gate
 * could ever have started firing was to cap a ten-seat professional trial at
 * one seat. Repairing the counter would have shipped that; the row is gone and
 * the cap now comes from this table via `resolveMaxUsers`.
 *
 * Express enforces seats the same way on the path where it works at all —
 * `ensureWithinUserLimit` (`backend/src/services/organization-invite.service.ts:286`)
 * counts users live and adds pending invites. This Worker has no invite table,
 * so the count is users alone; the pending-invite term is not dropped
 * deliberately, there is simply nothing to add.
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

/**
 * Seat cap for a tier. No env override exists for seats, so this is a lookup
 * rather than a resolver — it is a function anyway so that the gate in
 * `handleCreateLegacyUser` and the denominator reported by
 * `GET /api/organization/usage` cannot drift onto different expressions of the
 * same number.
 */
export function resolveMaxUsers(tier: LaunchTier): number {
  return LAUNCH_TIER_USER_LIMITS[tier];
}

/** Storage cap in bytes for a tier. No env override exists for storage. */
export function resolveStorageLimitBytes(tier: LaunchTier): number {
  return STORAGE_LIMIT_BYTES_BY_TIER[tier];
}

/**
 * Percentage of the storage cap at which `GET /api/storage-quota/:userId`
 * reports `isWarning`. Carried over from Express's `StorageQuotaService`, which
 * hardcoded 80 inline.
 */
export const STORAGE_WARNING_THRESHOLD_PERCENT = 80;

/**
 * Human-readable byte size, e.g. `1 GB` / `10 GB` / `1000 GB`.
 *
 * Kept byte-identical to Express's `StorageQuotaService.formatBytes`
 * (`backend/src/services/storage-quota.service.ts`) — including the space
 * before the unit and the `parseFloat(toFixed(2))` trailing-zero trim — because
 * `displayLimit` is rendered verbatim by the frontend, so any change here is a
 * visible copy change rather than a refactor. It lives beside
 * `STORAGE_LIMIT_BYTES_BY_TIER` so the numbers and the way they are spelled
 * cannot drift apart.
 */
export function formatStorageBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  // Clamped so a value above 1024 TB renders as a large number of TB rather
  // than indexing off the end of the table and printing `undefined`.
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Master switch for refusing over-cap writes. **Defaults to off.**
 *
 * The comparison is strict `=== 'true'`, matching `CATALOGUE_QUEUE_ENABLED`
 * (`index-minimal.ts:3478`), so a near-miss value like `"1"` or `"yes"` leaves
 * enforcement off rather than half-enabling it. A flag that guards writes
 * should fail towards the state that cannot reject a customer.
 *
 * **Off does not mean unmeasured.** Every gate still resolves the tier, still
 * applies the cap inside its INSERT, and still detects the write the cap would
 * have refused; it logs that as `usage_limit_reached` and then allows the
 * write. Two reasons the default is off:
 *
 * 1. The numbers in `LAUNCH_TIER_LIMITS` are provisional pending a usage
 *    trial. Enforcing them during the trial would cap usage at the guess and
 *    truncate the very data the trial exists to produce — the measurement
 *    would confirm the assumption instead of testing it.
 * 2. An organization whose Clerk webhook was dropped has no `subscription_tiers`
 *    row, so `getOrganizationLaunchTier` falls back to `free` and the org
 *    inherits the smallest caps in the table. With enforcement off that
 *    misconfiguration surfaces as a log line; with it on, a webhook failure
 *    becomes a hard write refusal for a paying customer.
 */
export function isUsageEnforcementEnabled(env: Env): boolean {
  return env.USAGE_LIMITS_ENFORCE === 'true';
}

/**
 * The cap passed to the counting INSERTs when enforcement is off.
 *
 * The retry deliberately reuses the same parameterised SQL rather than taking
 * a second, uncapped code path: one statement stays under test in both flag
 * states, and there is no unguarded INSERT in the file for a later change to
 * reach for by mistake. `Number.MAX_SAFE_INTEGER` is an exact JS integer and
 * sits far inside PostgreSQL `bigint`, so `COUNT(*) < $cap` is simply always
 * true.
 */
export const UNLIMITED_CAP = Number.MAX_SAFE_INTEGER;

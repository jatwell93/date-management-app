/**
 * Tier feature gating — POINTER FILE (task 3.1.0d).
 *
 * This file held 8 tests and imported **no production module**. Two were
 * `expect(expected).toBe(true)` placebos ("Feature access check cannot be
 * bypassed"); the other six asserted membership in a `features` array defined
 * in the local `fixtures.ts` — e.g. that `tierLimits.starter.features` does not
 * contain `'advanced_analytics'`. No production code reads that array, or any
 * array like it.
 *
 * `requireFeatureAccess()` and `checkFeatureAccess()` have **zero references
 * anywhere in the repository**. The Worker's nearest thing,
 * `utils/feature-gates.ts`, was deleted in task 3.1.a: it had no production
 * importer, and its SQL named `"Product"`/`"User"`/`"InventoryItem"` — tables
 * this schema does not have — so it would have thrown on first call.
 *
 * **Per-feature tier gating does not exist in this product.** Tier affects usage
 * LIMITS (`utils/usage-limits.ts`, really enforced and really tested) and
 * nothing else. Whether it should gate features is an open product decision,
 * tracked on the reopened audit rows part3:509 and part3:1167 and part4:454-455.
 *
 * Skipped rather than deleted: ~100 audit rows cite this path as
 * searched-and-empty evidence and must keep resolving.
 */
import { describe, it } from 'vitest';

describe.skip('Tier feature gating — NOT IMPLEMENTED; tier affects limits only', () => {
  it('has no production counterpart to assert against', () => {
    throw new Error('unreachable: this suite is skipped');
  });
});

/**
 * Subscription status gating — POINTER FILE (task 3.1.0d).
 *
 * This file held 14 tests, imported **no production module**, and described a
 * gate that **exists in neither backend**. Eight were
 * `expect(expected).toBe(true)` placebos ("Downgrade reduces feature access
 * immediately", "No subscription bypass via custom headers or tokens"); the
 * rest asserted the contents of a local fixture — including
 * `expect(gracePeriodDays).toBe(7)`, where the 7 was a constant defined three
 * lines above the assertion.
 *
 * The named middleware, `requireActiveSubscription()`, has **zero references
 * anywhere in the repository**. The live Worker reads `subscription_tiers` only
 * to resolve a TIER for usage limits (`getOrganizationLaunchTier`); it never
 * checks subscription STATUS, so a canceled or expired subscription blocks
 * nothing today.
 *
 * That gap is worth knowing precisely because it is a billing gate: the suite's
 * green ticks are the reason nobody noticed it was never written. See the
 * matching note in `org-status-integration.test.ts` — the same shape.
 *
 * **There is no real coverage to point at, and that is the finding.** The 2.2
 * manifest rows for these behaviours record the absence honestly.
 *
 * Skipped rather than deleted: ~223 audit rows cite this path as
 * searched-and-empty evidence and must keep resolving.
 */
import { describe, it } from 'vitest';

describe.skip('Subscription status gating — NOT IMPLEMENTED in either backend', () => {
  it('has no production counterpart to assert against', () => {
    throw new Error('unreachable: this suite is skipped');
  });
});

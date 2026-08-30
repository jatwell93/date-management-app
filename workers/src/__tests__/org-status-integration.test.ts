/**
 * Organization status gating — POINTER FILE (task 3.1.0d).
 *
 * This file held 19 tests, imported **no production module**, and described a
 * gate that **exists in neither backend**. Sixteen were
 * `expect(expected).toBe(true)` placebos under names like "Suspended → Active
 * transition re-enables writes" and "Status check applies to all feature
 * endpoints"; the other three asserted that a fixture object whose `status`
 * field had just been set to 'active' had a `status` of 'active'.
 *
 * The named middleware, `requireActiveOrganization()`, has **zero references
 * anywhere in the repository** — not in `workers/src`, not in `backend/src`,
 * not in any test. Nor does the live Worker check organization status by any
 * other name: `index-minimal.ts` performs no `organizations.status` lookup on
 * any request path.
 *
 * So this suite is not a placebo covering an untested gate. It is a green suite
 * describing a gate that was **never built**, which is strictly more dangerous:
 * the audit counted it as evidence that the behaviour was covered. This is the
 * same mechanism that let the cross-tenant defects in #462/#466 survive.
 *
 * **There is no real coverage to point at, and that is the finding.** If
 * suspending an organization is meant to block its writes, that is unbuilt
 * work, not untested work. The 2.2 manifest rows for these behaviours record
 * the absence honestly.
 *
 * Skipped rather than deleted: ~55 audit rows cite this path as
 * searched-and-empty evidence and must keep resolving.
 */
import { describe, it } from 'vitest';

describe.skip('Organization status gating — NOT IMPLEMENTED in either backend', () => {
  it('has no production counterpart to assert against', () => {
    throw new Error('unreachable: this suite is skipped');
  });
});

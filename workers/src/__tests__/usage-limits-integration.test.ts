/**
 * Usage limits integration — POINTER FILE (task 3.1.0d).
 *
 * This file held 13 tests and imported **no production module**. Four were
 * `expect(expected).toBe(true)` placebos; the other nine asserted the contents
 * of a local `tierLimits` fixture — and that fixture was **wrong**. It claimed
 * starter = 500 SKUs and professional = 2,000, where the real table
 * (`utils/usage-limits.ts`, conformant with `shared/types/subscription.ts`) is
 * 5,000 and 50,000. Its seat and storage numbers disagreed too. A reader taking
 * this suite as coverage would have concluded the Worker enforced limits an
 * order of magnitude smaller than it does.
 *
 * It also named `checkUsageLimit()`, which is an Express function
 * (`backend/src/middleware/feature-gate.middleware.ts`) with no Worker
 * counterpart of that name.
 *
 * **Real coverage now lives in:**
 *   - `../utils/usage-limits.test.ts` — the tier table, asserted as conformance
 *     against `shared/types/subscription.ts` rather than restating its numbers.
 *   - `../database.usage-limits.pglite.node.test.ts` — the caps against real SQL
 *     (at-cap, under-cap, cross-tenant, zero-cap, terminal statuses).
 *   - `../minimal-api-routes.test.ts` — the 402 route contract and the
 *     measure-only flag behaviour.
 *
 * Skipped rather than deleted: ~149 audit rows cite this path as
 * searched-and-empty evidence and must keep resolving.
 */
import { describe, it } from 'vitest';

describe.skip('Usage limits — relocated to utils/usage-limits.test.ts + the pglite suite', () => {
  it('is asserted there against the real tier table, not here against a wrong fixture', () => {
    throw new Error('unreachable: this suite is skipped');
  });
});

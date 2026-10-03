/**
 * The operator diagnostic (`src/operations/webhook-diagnostics.ts`, task 3.4)
 * labels an uncompleted webhook claim "in flight" or "stranded" using the same
 * stale windows the Worker uses to decide whether a redelivery may take a
 * claim over. It is a root module and cannot import Worker source, so it
 * restates the two numbers. This is the check that they have not drifted: a
 * diagnostic with a different window would call a claim stranded while the
 * Worker still treats it as owned, or the reverse.
 */
import { describe, expect, it } from 'vitest';
import { STALE_CLAIM_SECONDS } from '../../src/operations/webhook-diagnostics';
import { CLERK_WEBHOOK_STALE_CLAIM_SECONDS } from './clerk/clerk-persistence';
import { STRIPE_WEBHOOK_STALE_CLAIM_SECONDS } from './stripe/stripe-persistence';

describe('webhook diagnostics stale-claim windows', () => {
  it('match the windows the Worker claims with', () => {
    expect(STALE_CLAIM_SECONDS).toEqual({
      stripe: STRIPE_WEBHOOK_STALE_CLAIM_SECONDS,
      clerk: CLERK_WEBHOOK_STALE_CLAIM_SECONDS,
    });
  });
});

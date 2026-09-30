/**
 * `stripe-reconciliation` — daily drift check between Stripe's view of every
 * subscription and `subscription_tiers` (audit rows 10–13).
 *
 * For each locally-linked subscription, Stripe's state is re-applied through
 * the same code path a webhook delivery takes (`processSubscriptionEvent`), so
 * attribution, cancellation and superseded-subscription guards are identical
 * whether state arrives as an event or as a reconciliation read. Divergence is
 * logged both ways; the synthetic event id (`reconcile:<date>:<sub>`) keeps
 * those log lines attributable to this job rather than to a delivery.
 *
 * Two Express defects are not carried: `Promise.all` on the apply loop (a
 * single rejection failed the whole pass) becomes `Promise.allSettled`, and a
 * local row missing from Stripe is warned about but never deleted — no
 * auto-delete, per row 13's decision.
 *
 * No `STRIPE_SECRET_KEY` is not an error: the deployment may legitimately run
 * without checkout configured, so the job reports `skipped` instead of failing.
 * A pagination error, by contrast, throws — the run fails and the next tick
 * retries it.
 */
import * as Sentry from '@sentry/cloudflare';
import { listStripeSubscriptions } from '../../stripe/stripe-api';
import {
  processSubscriptionEvent,
  type StripeSubscriptionObject,
} from '../../stripe/subscription-events';
import type { JobContext, ScheduledJob } from '../schedule';

interface LocalLinkedRow {
  organizationId: string;
  stripeSubscriptionId: string;
  status: string;
}

function stripeId(subscription: StripeSubscriptionObject): string | null {
  return typeof subscription.id === 'string' ? subscription.id : null;
}

export const stripeReconciliationJob: ScheduledJob = {
  name: 'stripe-reconciliation',
  cadence: { kind: 'daily', hourUtc: 1 },
  leaseSeconds: 600,
  async run({ env, sql, asOf }: JobContext) {
    if (!env.STRIPE_SECRET_KEY?.trim()) {
      return { summary: { skipped: 'stripe-not-configured' } };
    }

    const stripeSubs = await listStripeSubscriptions<StripeSubscriptionObject>(env);
    const stripeById = new Map(
      stripeSubs.flatMap((sub) => {
        const id = stripeId(sub);
        return id ? [[id, sub] as const] : [];
      }),
    );

    const localRows = (await sql`
      SELECT organization_id AS "organizationId",
             stripe_subscription_id AS "stripeSubscriptionId",
             status
      FROM subscription_tiers
      WHERE stripe_subscription_id IS NOT NULL
    `) as LocalLinkedRow[];

    const asOfDate = asOf.toISOString().slice(0, 10);
    let applied = 0;
    let divergences = 0;
    let missingInStripe = 0;

    const outcomes = await Promise.allSettled(
      localRows.map(async (row) => {
        const stripeSub = stripeById.get(row.stripeSubscriptionId);
        if (!stripeSub) {
          missingInStripe += 1;
          // Deliberate no-write: a missing Stripe subscription is reported, not
          // deleted — a paid window must not be lost to a reconciliation bug.
          console.warn(
            JSON.stringify({
              event: 'stripe_reconciliation_divergence',
              kind: 'missing-in-stripe',
              organizationId: row.organizationId,
              stripeSubscriptionId: row.stripeSubscriptionId,
              localStatus: row.status,
            }),
          );
          return;
        }

        const stripeStatus = typeof stripeSub.status === 'string' ? stripeSub.status : '';
        if (row.status !== stripeStatus) {
          divergences += 1;
          console.warn(
            JSON.stringify({
              event: 'stripe_reconciliation_divergence',
              kind: 'status-mismatch',
              organizationId: row.organizationId,
              stripeSubscriptionId: row.stripeSubscriptionId,
              localStatus: row.status,
              stripeStatus,
            }),
          );
        }

        await processSubscriptionEvent(
          sql,
          stripeStatus === 'canceled'
            ? 'customer.subscription.deleted'
            : 'customer.subscription.updated',
          `reconcile:${asOfDate}:${stripeId(stripeSub)}`,
          stripeSub,
        );
        applied += 1;
      }),
    );

    const failures = outcomes.filter((o) => o.status === 'rejected');
    for (const failure of failures) {
      Sentry.captureException(failure.reason, {
        tags: { component: 'scheduled', job: 'stripe-reconciliation' },
      });
    }

    return {
      summary: {
        stripeSubscriptions: stripeSubs.length,
        localLinked: localRows.length,
        applied,
        divergences,
        missingInStripe,
        failures: failures.length,
      },
      failed: failures.length > 0,
    };
  },
};

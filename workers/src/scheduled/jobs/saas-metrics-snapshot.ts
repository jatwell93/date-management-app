/**
 * `saas-metrics-snapshot` — the daily SaaS metrics snapshot plus alert checks,
 * rebuilt from Express's dormant job (schedule-matrix rows 16–17) with the
 * formulas corrected rather than carried over:
 *
 *  - **MRR**: Express mixed per-seat ARPU with per-subscription counts. Here it
 *    is the monthly-equivalent price summed over every live paying
 *    `subscription_tiers` row (a past-due row still counts inside the shared
 *    dunning grace, and a canceled row inside its paid window, via
 *    `deriveSubscriptionAccess`). `tier_distribution` is redefined as *paying
 *    customers per tier* — nothing reads the column today.
 *  - **Churn baseline**: Express took "customers at start" as the sum of two
 *    30-day flow counts from an old snapshot, which is not a customer count —
 *    the baseline here is the snapshot written SAAS_METRICS_WINDOW_DAYS before
 *    the snapshot date, with its `tier_distribution` summed back into a
 *    paying-customer count.
 *  - **Conversion cohort**: Express used `trial_end_date`, which the Stripe
 *    upsert overwrites on conversion — the metric would always read 0. The
 *    cohort is dated by `trial_started_at + PROFESSIONAL_TRIAL_DAYS`, which no
 *    writer touches, and "converted" means *ever linked* to a Stripe
 *    subscription (`stripe_subscription_id IS NOT NULL` — cancellation does
 *    not null it).
 *  - **Churn dating**: `updated_at` cannot date a cancellation —
 *    stripe-reconciliation bumps it every run — so the lapse is dated by
 *    `current_period_end`; an immediate cancellation therefore counts on its
 *    period-end date.
 *  - **Dropped**: webhook- and payment-failure metrics — rows 19–21 live in
 *    `webhook-monitoring`, and the payment-failure check was never implemented.
 *
 * The snapshot row is keyed by `date` (the day the snapshot describes), so a
 * re-run for the same date updates in place rather than duplicating.
 */
import * as Sentry from '@sentry/cloudflare';
import {
  ALERT_THRESHOLDS,
  PROFESSIONAL_TRIAL_DAYS,
  TIER_ANNUAL_PRICES,
  TIER_PRICES,
} from '../../../../shared/types/subscription';
import { parseDbTimestamp } from '../../credit-claim-service';
import { deriveSubscriptionAccess } from '../../subscription-status';
import type { JobContext, ScheduledJob } from '../schedule';

/** Trailing window (days) the trial-cohort and churn counts cover. */
export const SAAS_METRICS_WINDOW_DAYS = 30;

/**
 * Minimum cohort size before a rate can alert — a percentage on a handful of
 * trials or customers is noise, so below this the snapshot stores the number
 * but never pages.
 */
export const SAAS_ALERT_MIN_SAMPLE = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type AlertType = 'low_trial_conversion' | 'high_churn_rate';

function alert(alertType: AlertType, message: string, extra: Record<string, unknown>): void {
  Sentry.captureMessage(`[saas-metrics-snapshot] ${message}`, {
    level: 'warning',
    tags: { component: 'saas_metrics', alert_type: alertType },
    fingerprint: ['saas_metrics', alertType],
    extra,
  });
  console.warn(JSON.stringify({ event: 'saas_metrics_alert', alert_type: alertType, ...extra }));
}

interface PayingCandidateRow {
  tierLevel: string;
  status: string;
  billingCycle: string;
  trialEndDate: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : parseDbTimestamp(value);
}

/**
 * The previous snapshot's paying-customer total, recovered from its stored
 * `tier_distribution` JSON. Returns null when there is no baseline row, the
 * JSON is missing/invalid, or it is not an object — no baseline means no
 * meaningful churn *rate* (the raw churn count is still stored).
 */
function customersAtStartFrom(tierDistribution: unknown): number | null {
  if (typeof tierDistribution !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(tierDistribution);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  let total = 0;
  for (const value of Object.values(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

export const saasMetricsSnapshotJob: ScheduledJob = {
  name: 'saas-metrics-snapshot',
  cadence: { kind: 'daily', hourUtc: 2 },
  leaseSeconds: 300,
  async run({ sql, asOf }: JobContext) {
    // All instants are UTC-midnight-aligned off asOf: the tick's own hour
    // never leaks into the windows, so a delayed tick writes the same row.
    const periodEnd = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const snapshotDate = new Date(periodEnd.getTime() - MS_PER_DAY);
    const windowStart = new Date(periodEnd.getTime() - SAAS_METRICS_WINDOW_DAYS * MS_PER_DAY);
    const baselineDate = new Date(snapshotDate.getTime() - SAAS_METRICS_WINDOW_DAYS * MS_PER_DAY);
    const snapshotDateIso = snapshotDate.toISOString();
    const periodEndIso = periodEnd.toISOString();
    const windowStartIso = windowStart.toISOString();
    const baselineDateIso = baselineDate.toISOString();

    // Trial cohort: trials whose nominal end (trial_started_at + the shared
    // 14-day length — never rewritten by the Stripe upsert) fell in the window.
    const cohortRows = (await sql`
      SELECT COUNT(*)::int AS ended,
             COUNT(*) FILTER (WHERE stripe_subscription_id IS NOT NULL)::int AS converted
      FROM subscription_tiers
      WHERE trial_started_at IS NOT NULL
        AND trial_started_at + make_interval(days => ${PROFESSIONAL_TRIAL_DAYS}::int) >= ${windowStartIso}::timestamp
        AND trial_started_at + make_interval(days => ${PROFESSIONAL_TRIAL_DAYS}::int) <  ${periodEndIso}::timestamp
    `) as Array<{ ended: number; converted: number }>;
    const { ended, converted } = cohortRows[0] ?? { ended: 0, converted: 0 };
    const trialConversionRate = ended > 0 ? (converted / ended) * 100 : null;

    // Paying = the same lapse rule the request path uses
    // (`deriveSubscriptionAccess`), deliberately narrowed in SQL. A canceled
    // row still counts while inside its paid window; an immediate
    // cancellation (cancel_at_period_end = false) lapses at once, matching
    // the request path. Statuses the derivation does not recognize are
    // excluded here rather than failed open into a revenue number — they
    // cannot be evaluated for "still paying" when their semantics are
    // unknown — and are counted separately below so the exclusion is not
    // silent.
    const candidates = (await sql`
      SELECT tier_level AS "tierLevel", status,
             billing_cycle AS "billingCycle",
             trial_end_date::text AS "trialEndDate",
             current_period_end::text AS "currentPeriodEnd",
             cancel_at_period_end AS "cancelAtPeriodEnd",
             past_due_since::text AS "pastDueSince"
      FROM subscription_tiers
      WHERE stripe_subscription_id IS NOT NULL
        AND (
          status IN ('active', 'past_due')
          OR (
            status IN ('canceled', 'cancelled')
            AND cancel_at_period_end
            AND current_period_end > ${periodEndIso}::timestamp
          )
        )
    `) as PayingCandidateRow[];

    let payingCustomers = 0;
    let unpricedCustomers = 0;
    let mrrCents = 0;
    const tierDistribution: Record<string, number> = {};
    for (const row of candidates) {
      // The lapse is evaluated at periodEnd, not asOf: the paying count is a
      // pure function of the snapshot date, so the tick's own hour — or a
      // delayed catch-up replay — can never change it.
      const access = deriveSubscriptionAccess(
        {
          status: row.status,
          tier_level: row.tierLevel,
          trial_end_date: toDateOrNull(row.trialEndDate),
          current_period_end: toDateOrNull(row.currentPeriodEnd),
          cancel_at_period_end: row.cancelAtPeriodEnd,
          past_due_since: toDateOrNull(row.pastDueSince),
        },
        periodEnd,
      );
      if (access.lapsed) {
        continue;
      }
      const tier = String(row.tierLevel).trim().toLowerCase();
      payingCustomers += 1;
      tierDistribution[tier] = (tierDistribution[tier] ?? 0) + 1;
      if (!(tier in TIER_PRICES)) {
        unpricedCustomers += 1;
        continue;
      }
      mrrCents +=
        row.billingCycle === 'annual'
          ? TIER_ANNUAL_PRICES[tier as keyof typeof TIER_ANNUAL_PRICES] / 12
          : TIER_PRICES[tier as keyof typeof TIER_PRICES];
    }
    const arpuCents = payingCustomers > 0 ? mrrCents / payingCustomers : null;

    // The deliberate exclusion from the candidates query, made visible:
    // Stripe statuses the derivation does not recognize (e.g. 'unpaid', or a
    // status a future writer introduces) cannot be judged "still paying", so
    // they are kept out of the revenue number and counted here instead of
    // dropped silently. Recognized non-paying states — trialing, and canceled
    // rows outside their paid window — are excluded above, not counted here.
    const unrecognizedRows = (await sql`
      SELECT COUNT(*)::int AS unrecognized
      FROM subscription_tiers
      WHERE stripe_subscription_id IS NOT NULL
        AND status NOT IN ('active', 'past_due', 'trialing', 'canceled', 'cancelled', 'incomplete_expired')
    `) as Array<{ unrecognized: number }>;
    const unrecognizedCustomers = unrecognizedRows[0]?.unrecognized ?? 0;

    // Churned in the window, dated by current_period_end — the day the lapse
    // took effect — because updated_at is touched by every reconciliation run
    // and cannot carry meaning. An immediate cancellation counts on its
    // period-end date, not the click date.
    const churnRows = (await sql`
      SELECT COUNT(*)::int AS churned
      FROM subscription_tiers
      WHERE status IN ('canceled', 'cancelled')
        AND stripe_subscription_id IS NOT NULL
        AND current_period_end >= ${windowStartIso}::timestamp
        AND current_period_end <  ${periodEndIso}::timestamp
    `) as Array<{ churned: number }>;
    const churned = churnRows[0]?.churned ?? 0;

    // Churn baseline: the paying-customer total from the snapshot one window
    // earlier. No baseline row → no rate, only the raw count.
    const baselineRows = (await sql`
      SELECT tier_distribution
      FROM metrics_snapshots
      WHERE date = ${baselineDateIso}::timestamp
    `) as Array<{ tier_distribution: unknown }>;
    const customersAtStart = baselineRows.length
      ? customersAtStartFrom(baselineRows[0].tier_distribution)
      : null;
    const churnRate =
      customersAtStart !== null && customersAtStart > 0 ? (churned / customersAtStart) * 100 : null;

    // avg_revenue_per_user is stored in CENTS (Express mixed dollars and cents
    // across this column). Keyed upsert on `date` makes a re-run idempotent.
    await sql`
      INSERT INTO metrics_snapshots (date, trial_conversion_rate, avg_revenue_per_user,
        churn_rate, total_trials, total_conversions, total_churn, total_revenue_cents,
        tier_distribution)
      VALUES (${snapshotDateIso}::timestamp, ${trialConversionRate}, ${arpuCents},
        ${churnRate}, ${ended}, ${converted}, ${churned}, ${Math.round(mrrCents)},
        ${JSON.stringify(tierDistribution)})
      ON CONFLICT (date) DO UPDATE SET
        trial_conversion_rate = EXCLUDED.trial_conversion_rate,
        avg_revenue_per_user = EXCLUDED.avg_revenue_per_user,
        churn_rate = EXCLUDED.churn_rate,
        total_trials = EXCLUDED.total_trials,
        total_conversions = EXCLUDED.total_conversions,
        total_churn = EXCLUDED.total_churn,
        total_revenue_cents = EXCLUDED.total_revenue_cents,
        tier_distribution = EXCLUDED.tier_distribution
    `;

    // Alerts are warnings, never failures: a noisy metric must not flip the
    // job's run row to failed and block the next day's snapshot.
    const alerted: AlertType[] = [];
    if (
      ended >= SAAS_ALERT_MIN_SAMPLE &&
      trialConversionRate !== null &&
      trialConversionRate < ALERT_THRESHOLDS.trialConversionRateMin
    ) {
      alerted.push('low_trial_conversion');
      alert('low_trial_conversion', 'Trial conversion rate below threshold', {
        trialConversionRate,
        trialsEnded: ended,
        trialsConverted: converted,
        threshold: ALERT_THRESHOLDS.trialConversionRateMin,
      });
    }
    if (
      customersAtStart !== null &&
      customersAtStart >= SAAS_ALERT_MIN_SAMPLE &&
      churnRate !== null &&
      churnRate > ALERT_THRESHOLDS.churnRateMax
    ) {
      alerted.push('high_churn_rate');
      alert('high_churn_rate', 'Churn rate above threshold', {
        churnRate,
        churned,
        customersAtStart,
        threshold: ALERT_THRESHOLDS.churnRateMax,
      });
    }

    // Not one of the job's two alerts — no Sentry — but a nonzero
    // unrecognized-status count must not be silent either: it rides the
    // summary and gets its own warning line for the log stream.
    if (unrecognizedCustomers > 0) {
      console.warn(
        JSON.stringify({
          event: 'saas_metrics_unrecognized_statuses',
          snapshotDate: snapshotDateIso,
          unrecognizedCustomers,
        }),
      );
    }

    return {
      summary: {
        snapshotDate: snapshotDateIso,
        trialsEnded: ended,
        trialsConverted: converted,
        trialConversionRate,
        payingCustomers,
        mrrCents,
        unpricedCustomers,
        unrecognizedCustomers,
        churned,
        customersAtStart,
        churnRate,
        alerted,
      },
    };
  },
};

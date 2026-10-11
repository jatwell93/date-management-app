/**
 * Real-SQL (pglite) coverage for the `saas-metrics-snapshot` scheduled job —
 * task 3.3c.
 *
 * Asserted here because only SQL can prove it: the trial-cohort window
 * boundaries (`trial_started_at + PROFESSIONAL_TRIAL_DAYS` in
 * `[windowStart, periodEnd)`), the paying-customer filter through
 * `deriveSubscriptionAccess`, the churn window on `current_period_end`, the
 * baseline read-back from a prior `metrics_snapshots.tier_distribution`, the
 * `ON CONFLICT (date)` re-run, and the minimum-sample alert gates.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from '../../__tests__/pglite-db';
import {
  PROFESSIONAL_TRIAL_DAYS,
  TIER_ANNUAL_PRICES,
  TIER_PRICES,
} from '../../../../shared/types/subscription';
import { DUNNING_GRACE_DAYS } from '../../subscription-status';

const sentryCalls = vi.hoisted(() => ({ messages: [] as unknown[], exceptions: [] as unknown[] }));

vi.mock('@sentry/cloudflare', () => ({
  withSentry: <T>(_options: unknown, handler: T) => handler,
  captureException: (error: unknown, context?: unknown) => {
    sentryCalls.exceptions.push([error, context]);
  },
  captureMessage: (message: unknown, context?: unknown) => {
    sentryCalls.messages.push([message, context]);
  },
}));

import { saasMetricsSnapshotJob } from './saas-metrics-snapshot';
import type { SqlClient } from '../schedule';

// periodEnd = 2026-10-02T00:00Z, snapshotDate = 2026-10-01, windowStart =
// 2026-09-02, baselineDate = 2026-09-01.
const AS_OF = new Date('2026-10-02T02:00:00.000Z');
const SNAPSHOT_DATE_ISO = '2026-10-01T00:00:00.000Z';
const BASELINE_DATE_ISO = '2026-09-01T00:00:00.000Z';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ENV = { NODE_ENV: 'test' } as unknown as Env;

interface SnapshotRow {
  date: string;
  trial_conversion_rate: number | null;
  avg_revenue_per_user: number | null;
  churn_rate: number | null;
  total_trials: number;
  total_conversions: number;
  total_churn: number;
  total_revenue_cents: number;
  tier_distribution: string | null;
}

describe('saas-metrics-snapshot job (pglite)', () => {
  let harness: PgliteHarness;
  let sql: SqlClient;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    sentryCalls.messages.length = 0;
    sentryCalls.exceptions.length = 0;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await sql`DELETE FROM metrics_snapshots`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM organizations`;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function seedTier(
    orgId: string,
    opts: {
      status?: string;
      tierLevel?: string;
      stripeSubscriptionId?: string | null;
      billingCycle?: string;
      trialStartedAt?: string | null;
      trialEndDate?: string | null;
      currentPeriodEnd?: string | null;
      cancelAtPeriodEnd?: boolean;
      pastDueSince?: string | null;
    } = {},
  ): Promise<void> {
    await seedOrganization(harness.pg, orgId);
    await sql`
      INSERT INTO subscription_tiers (
        organization_id, tier_level, status, billing_cycle,
        stripe_subscription_id, trial_started_at, trial_end_date,
        current_period_end, cancel_at_period_end, past_due_since, updated_at
      ) VALUES (
        ${orgId}, ${opts.tierLevel ?? 'starter'}, ${opts.status ?? 'active'},
        ${opts.billingCycle ?? 'monthly'},
        ${opts.stripeSubscriptionId === undefined ? `sub_${orgId}` : opts.stripeSubscriptionId},
        ${opts.trialStartedAt ?? null}::timestamp,
        ${opts.trialEndDate ?? null}::timestamp,
        ${opts.currentPeriodEnd ?? null}::timestamp,
        ${opts.cancelAtPeriodEnd ?? false},
        ${opts.pastDueSince ?? null}::timestamp,
        NOW()
      )`;
  }

  /** The trial start whose nominal end lands `daysBefore` days before `end`. */
  function startedEndingAt(endIso: string, daysBefore = PROFESSIONAL_TRIAL_DAYS): string {
    return new Date(Date.parse(endIso) - daysBefore * MS_PER_DAY).toISOString();
  }

  async function snapshotRow(dateIso = SNAPSHOT_DATE_ISO): Promise<SnapshotRow | null> {
    const rows = (await sql`
      SELECT date::text AS date, trial_conversion_rate, avg_revenue_per_user,
             churn_rate, total_trials, total_conversions, total_churn,
             total_revenue_cents, tier_distribution
      FROM metrics_snapshots
      WHERE date = ${dateIso}::timestamp
    `) as SnapshotRow[];
    return rows[0] ?? null;
  }

  async function seedBaselineSnapshot(distribution: string): Promise<void> {
    await sql`
      INSERT INTO metrics_snapshots (date, tier_distribution)
      VALUES (${BASELINE_DATE_ISO}::timestamp, ${distribution})`;
  }

  it('writes an empty snapshot row with null rates and no alerts on an empty DB', async () => {
    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    const row = await snapshotRow();
    expect(row).not.toBeNull();
    expect(row?.total_trials).toBe(0);
    expect(row?.total_conversions).toBe(0);
    expect(row?.total_churn).toBe(0);
    expect(row?.total_revenue_cents).toBe(0);
    expect(row?.trial_conversion_rate).toBeNull();
    expect(row?.avg_revenue_per_user).toBeNull();
    expect(row?.churn_rate).toBeNull();
    expect(JSON.parse(row!.tier_distribution!)).toEqual({});
    expect(result.summary).toMatchObject({
      snapshotDate: SNAPSHOT_DATE_ISO,
      trialsEnded: 0,
      trialsConverted: 0,
      payingCustomers: 0,
      mrrCents: 0,
      churned: 0,
      customersAtStart: null,
      churnRate: null,
      alerted: [],
    });
    expect(sentryCalls.messages).toHaveLength(0);
  });

  it('counts the trial cohort inside the nominal-end window boundaries', async () => {
    // Nominal end = trial_started_at + 14d. In [windowStart, periodEnd):
    //  - started 2026-08-19 → ends exactly windowStart (2026-09-02): included.
    //  - in-window, converted (stripe_subscription_id) + in-window, not.
    //  - started 2026-09-18 → ends exactly periodEnd (2026-10-02): excluded.
    //  - ended 2026-08-15 (old) and ends 2026-10-09 (future): excluded.
    await seedTier('org_edge_in', {
      trialStartedAt: startedEndingAt('2026-09-02T00:00:00.000Z'),
      stripeSubscriptionId: null,
    });
    await seedTier('org_conv', {
      trialStartedAt: startedEndingAt('2026-09-10T00:00:00.000Z'),
      stripeSubscriptionId: 'sub_conv',
    });
    await seedTier('org_unconv', {
      trialStartedAt: startedEndingAt('2026-09-10T00:00:00.000Z'),
      stripeSubscriptionId: null,
    });
    await seedTier('org_edge_out', {
      trialStartedAt: startedEndingAt('2026-10-02T00:00:00.000Z'),
      stripeSubscriptionId: null,
    });
    await seedTier('org_old', {
      trialStartedAt: startedEndingAt('2026-08-15T00:00:00.000Z'),
      stripeSubscriptionId: null,
    });
    await seedTier('org_future', {
      trialStartedAt: startedEndingAt('2026-10-09T00:00:00.000Z'),
      stripeSubscriptionId: null,
    });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    const row = await snapshotRow();
    expect(row?.total_trials).toBe(3);
    expect(row?.total_conversions).toBe(1);
    expect(row?.trial_conversion_rate).toBeCloseTo(100 / 3, 5);
    expect(result.summary).toMatchObject({
      trialsEnded: 3,
      trialsConverted: 1,
    });
    expect(result.summary.trialConversionRate).toBeCloseTo(100 / 3, 5);
  });

  it('sums MRR over paying rows and re-checks lapse through deriveSubscriptionAccess', async () => {
    await seedTier('org_m_starter', { tierLevel: 'starter' });
    await seedTier('org_a_prof', { tierLevel: 'professional', billingCycle: 'annual' });
    await seedTier('org_pd_in', {
      status: 'past_due',
      tierLevel: 'starter',
      pastDueSince: new Date(AS_OF.getTime() - 3 * MS_PER_DAY).toISOString(),
    });
    await seedTier('org_pd_out', {
      status: 'past_due',
      tierLevel: 'starter',
      pastDueSince: new Date(AS_OF.getTime() - (DUNNING_GRACE_DAYS + 3) * MS_PER_DAY).toISOString(),
    });
    await seedTier('org_no_sub', { stripeSubscriptionId: null });
    await seedTier('org_trial', { status: 'trialing' });
    await seedTier('org_canceled', { status: 'canceled' });
    await seedTier('org_gold', { tierLevel: 'gold' });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    const expectedMrr = TIER_PRICES.starter * 2 + TIER_ANNUAL_PRICES.professional / 12;
    const row = await snapshotRow();
    expect(result.summary).toMatchObject({
      payingCustomers: 4,
      unpricedCustomers: 1,
      mrrCents: expectedMrr,
    });
    expect(row?.total_revenue_cents).toBe(Math.round(expectedMrr));
    // avg_revenue_per_user is stored in cents.
    expect(row?.avg_revenue_per_user).toBeCloseTo(expectedMrr / 4, 5);
    expect(JSON.parse(row!.tier_distribution!)).toEqual({
      starter: 2,
      professional: 1,
      gold: 1,
    });
  });

  it('counts a canceled row still inside its paid window as paying', async () => {
    // cancel_at_period_end + current_period_end after periodEnd — the customer
    // keeps what they already paid for, same as the request path.
    await seedTier('org_cancel_window', {
      status: 'canceled',
      tierLevel: 'professional',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-10-15T00:00:00Z',
    });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(result.summary).toMatchObject({
      payingCustomers: 1,
      mrrCents: TIER_PRICES.professional,
      churned: 0,
      unrecognizedCustomers: 0,
    });
    const row = await snapshotRow();
    expect(row?.total_revenue_cents).toBe(TIER_PRICES.professional);
    expect(JSON.parse(row!.tier_distribution!)).toEqual({ professional: 1 });
  });

  it('does not count an immediate cancellation (cancel_at_period_end=false) as paying', async () => {
    // Lapses at once on the request path, so it is not paying here either;
    // current_period_end sits outside [windowStart, periodEnd) so the churn
    // count stays out of this test.
    await seedTier('org_cancel_now', {
      status: 'canceled',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-10-15T00:00:00Z',
    });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(result.summary).toMatchObject({
      payingCustomers: 0,
      mrrCents: 0,
      churned: 0,
      unrecognizedCustomers: 0,
    });
    const row = await snapshotRow();
    expect(JSON.parse(row!.tier_distribution!)).toEqual({});
  });

  it('does not count a canceled row whose paid window ended before periodEnd', async () => {
    // Paid window already over at periodEnd — and before the churn window
    // too, so the test stays single-purpose.
    await seedTier('org_cancel_lapsed', {
      status: 'canceled',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-08-20T00:00:00Z',
    });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(result.summary).toMatchObject({
      payingCustomers: 0,
      churned: 0,
      unrecognizedCustomers: 0,
    });
  });

  it('evaluates the lapse at periodEnd, so the paying count is identical whatever the tick hour', async () => {
    // Grace ends 2026-10-02T12:00Z — after periodEnd (midnight) but before the
    // 23:00 tick. Evaluating at asOf would make the two ticks disagree.
    await seedTier('org_pd_boundary', {
      status: 'past_due',
      tierLevel: 'starter',
      pastDueSince: new Date(
        Date.parse('2026-10-02T12:00:00.000Z') - DUNNING_GRACE_DAYS * MS_PER_DAY,
      ).toISOString(),
    });

    const early = await saasMetricsSnapshotJob.run({
      env: ENV,
      sql,
      asOf: new Date('2026-10-02T02:00:00.000Z'),
    });
    const late = await saasMetricsSnapshotJob.run({
      env: ENV,
      sql,
      asOf: new Date('2026-10-02T23:00:00.000Z'),
    });

    // The row was paying for most of snapshot day 2026-10-01, so both ticks
    // count it — the count is a pure function of the snapshot date.
    expect(early.summary.payingCustomers).toBe(1);
    expect(late.summary.payingCustomers).toBe(early.summary.payingCustomers);
  });

  it('counts an unrecognized Stripe status separately instead of failing it open into paying', async () => {
    // 'incomplete' is a real Stripe status the derivation does not recognize.
    // The request path fails it open; a revenue metric must not — so it is
    // excluded from paying and surfaced in unrecognizedCustomers.
    await seedTier('org_incomplete', { status: 'incomplete', tierLevel: 'starter' });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(result.summary).toMatchObject({
      payingCustomers: 0,
      mrrCents: 0,
      unrecognizedCustomers: 1,
      alerted: [],
    });
    const row = await snapshotRow();
    expect(row).not.toBeNull();
    expect(row?.total_revenue_cents).toBe(0);
    expect(JSON.parse(row!.tier_distribution!)).toEqual({});
    // No Sentry alert — but the exclusion is not silent: one warning line.
    expect(sentryCalls.messages).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      event: 'saas_metrics_unrecognized_statuses',
      unrecognizedCustomers: 1,
    });
  });

  it.each(['unpaid', 'paused', 'incomplete_expired'])(
    'does not count a %s row as unrecognized or as paying',
    async (status) => {
      // Both are recognized lapses in `deriveSubscriptionAccess`, so they are a
      // known non-paying state: out of revenue, and not log noise that could
      // mask a genuinely unknown status.
      await seedTier(`org_${status}`, { status, tierLevel: 'starter' });

      const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

      expect(result.summary).toMatchObject({
        payingCustomers: 0,
        mrrCents: 0,
        unrecognizedCustomers: 0,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it('does not count a legitimately excluded canceled row as unrecognized', async () => {
    // Canceled outside the paid window is excluded by the candidates
    // prefilter as a *recognized* non-paying state — it is not an
    // unrecognized status.
    await seedTier('org_cancel_old', {
      status: 'canceled',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-08-20T00:00:00Z',
    });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(result.summary).toMatchObject({
      payingCustomers: 0,
      unrecognizedCustomers: 0,
      churned: 0,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dates churn by current_period_end inside the window, with a null rate without a baseline', async () => {
    await seedTier('org_churned', { status: 'canceled', currentPeriodEnd: '2026-09-15T00:00:00Z' });
    await seedTier('org_early', { status: 'canceled', currentPeriodEnd: '2026-08-20T00:00:00Z' });
    await seedTier('org_late', { status: 'canceled', currentPeriodEnd: '2026-10-02T00:00:00Z' });
    await seedTier('org_nosub', {
      status: 'canceled',
      stripeSubscriptionId: null,
      currentPeriodEnd: '2026-09-15T00:00:00Z',
    });

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    const row = await snapshotRow();
    expect(row?.total_churn).toBe(1);
    expect(row?.churn_rate).toBeNull();
    expect(result.summary).toMatchObject({ churned: 1, customersAtStart: null, churnRate: null });
  });

  it("derives the churn rate from the previous snapshot's tier_distribution", async () => {
    await seedTier('org_churned', { status: 'canceled', currentPeriodEnd: '2026-09-15T00:00:00Z' });
    await seedBaselineSnapshot(JSON.stringify({ starter: 8, professional: 4 }));

    const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    const row = await snapshotRow();
    expect(row?.total_churn).toBe(1);
    expect(row?.churn_rate).toBeCloseTo((1 / 12) * 100, 5);
    expect(result.summary).toMatchObject({ churned: 1, customersAtStart: 12 });
    expect(result.summary.churnRate).toBeCloseTo((1 / 12) * 100, 5);
  });

  it('updates the same date row in place on re-run instead of duplicating it', async () => {
    await seedTier('org_conv', {
      trialStartedAt: startedEndingAt('2026-09-10T00:00:00.000Z'),
    });
    await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    // A second run for the same snapshotDate after the world changed must
    // overwrite, not append.
    await seedTier('org_unconv', {
      trialStartedAt: startedEndingAt('2026-09-10T00:00:00.000Z'),
      stripeSubscriptionId: null,
    });
    await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

    const all = (await sql`SELECT id FROM metrics_snapshots`) as Array<{ id: number }>;
    expect(all).toHaveLength(1);
    const row = await snapshotRow();
    expect(row?.total_trials).toBe(2);
    expect(row?.total_conversions).toBe(1);
    expect(row?.trial_conversion_rate).toBeCloseTo(50, 5);
  });

  describe('alerts', () => {
    async function seedEndedTrials(count: number, converted = 0): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await seedTier(`org_trial_${i}`, {
          trialStartedAt: startedEndingAt('2026-09-10T00:00:00.000Z'),
          stripeSubscriptionId: i < converted ? `sub_${i}` : null,
        });
      }
    }

    it('warns once on low trial conversion at the minimum sample', async () => {
      await seedEndedTrials(10);

      const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

      expect(result.summary.alerted).toEqual(['low_trial_conversion']);
      expect(sentryCalls.messages).toHaveLength(1);
      const [, context] = sentryCalls.messages[0] as [
        string,
        { level: string; fingerprint: string[]; tags: Record<string, string> },
      ];
      expect(context.fingerprint).toEqual(['saas_metrics', 'low_trial_conversion']);
      expect(context.level).toBe('warning');
      expect(context.tags).toMatchObject({
        component: 'saas_metrics',
        alert_type: 'low_trial_conversion',
      });
    });

    it('does not warn below the minimum trial sample', async () => {
      await seedEndedTrials(9);

      const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

      expect(result.summary.alerted).toEqual([]);
      expect(sentryCalls.messages).toHaveLength(0);
    });

    it('warns on churn above threshold only when the baseline meets the minimum sample', async () => {
      await seedTier('org_churned', {
        status: 'canceled',
        currentPeriodEnd: '2026-09-15T00:00:00Z',
      });
      // 1/10 = 10% > 5% threshold with a baseline of exactly the minimum.
      await seedBaselineSnapshot(JSON.stringify({ starter: 10 }));

      const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

      expect(result.summary.alerted).toEqual(['high_churn_rate']);
      const [, context] = sentryCalls.messages[0] as [string, { fingerprint: string[] }];
      expect(context.fingerprint).toEqual(['saas_metrics', 'high_churn_rate']);
    });

    it('does not warn on churn when the baseline is below the minimum sample', async () => {
      await seedTier('org_churned', {
        status: 'canceled',
        currentPeriodEnd: '2026-09-15T00:00:00Z',
      });
      // 1/9 ≈ 11% > 5%, but 9 customers is below the minimum sample.
      await seedBaselineSnapshot(JSON.stringify({ starter: 9 }));

      const result = await saasMetricsSnapshotJob.run({ env: ENV, sql, asOf: AS_OF });

      expect(result.summary.alerted).toEqual([]);
      expect(sentryCalls.messages).toHaveLength(0);
    });
  });
});

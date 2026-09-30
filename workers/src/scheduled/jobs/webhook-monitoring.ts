/**
 * `webhook-monitoring` — hourly health check on webhook delivery (audit rows
 * 19–21), raising Sentry alerts rather than failing itself.
 *
 * Three signals, thresholds from `ALERT_THRESHOLDS` (`webhookFailureRateMax`):
 *
 *   1. Failure rate for the UTC day containing `asOf`, from `webhook_metrics`
 *      (written by `recordWebhookOutcome`): failures/total > 5% alerts — but
 *      only once at least `WEBHOOK_FAILURE_RATE_MIN_VOLUME` deliveries have
 *      been recorded, so a handful of early deliveries can't trip it.
 *   2. Absolute daily error count > 1 — a rate can look fine on low volume
 *      while real deliveries are failing.
 *   3. Replay growth: `processed_webhook_events.processed_at` count in the last
 *      hour vs the hour before. When the previous hour has at least
 *      `REPLAY_RATIO_MIN_BASELINE` events, a >5× ratio alerts; below that
 *      baseline a ratio is noise, so the rule is volume: >100 current-hour
 *      events counts as a spike.
 *
 * Every alert carries fingerprint `['webhook_monitoring', alert_type]` so the
 * hourly repeats group into one Sentry issue per alert kind instead of one
 * issue per tick.
 */
import * as Sentry from '@sentry/cloudflare';
import { ALERT_THRESHOLDS } from '../../../../shared/types/subscription';
import type { JobContext, ScheduledJob } from '../schedule';

type AlertType = 'failure_rate' | 'daily_error_count' | 'replay_attack_suspected';

/** A failure rate is only meaningful once this many deliveries were recorded. */
const WEBHOOK_FAILURE_RATE_MIN_VOLUME = 20;

/**
 * A replay-growth ratio needs a baseline to divide by. Below this many
 * previous-hour events the ratio is noise (1→6 is "five-fold" on nothing), so
 * the check falls back to absolute volume.
 */
const REPLAY_RATIO_MIN_BASELINE = 10;

function alert(
  alertType: AlertType,
  severity: 'critical' | 'warning',
  message: string,
  extra: Record<string, unknown>,
): void {
  Sentry.captureMessage(`[webhook-monitoring] ${message}`, {
    level: severity === 'critical' ? 'error' : 'warning',
    tags: { component: 'webhook_monitoring', alert_type: alertType, severity },
    fingerprint: ['webhook_monitoring', alertType],
    extra,
  });
  console.warn(
    JSON.stringify({
      event: 'webhook_monitoring_alert',
      alert_type: alertType,
      severity,
      ...extra,
    }),
  );
}

export const webhookMonitoringJob: ScheduledJob = {
  name: 'webhook-monitoring',
  cadence: { kind: 'hourly' },
  leaseSeconds: 300,
  async run({ sql, asOf }: JobContext) {
    const asOfIso = asOf.toISOString();
    const hourAgoIso = new Date(asOf.getTime() - 60 * 60 * 1000).toISOString();
    const twoHoursAgoIso = new Date(asOf.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const [metricRows, replayRows] = await Promise.all([
      sql`
        SELECT COALESCE(SUM(total_count), 0)::int AS total,
               COALESCE(SUM(failure_count), 0)::int AS failures
        FROM webhook_metrics
        WHERE date = date_trunc('day', ${asOfIso}::timestamp)
      `,
      sql`
        SELECT COUNT(*) FILTER (
                 WHERE processed_at >= ${hourAgoIso}::timestamp
                   AND processed_at < ${asOfIso}::timestamp)::int AS current_hour,
               COUNT(*) FILTER (
                 WHERE processed_at >= ${twoHoursAgoIso}::timestamp
                   AND processed_at < ${hourAgoIso}::timestamp)::int AS previous_hour
        FROM processed_webhook_events
        WHERE processed_at >= ${twoHoursAgoIso}::timestamp
          AND processed_at < ${asOfIso}::timestamp
      `,
    ]);

    const metrics = (metricRows as Array<{ total: number; failures: number }>)[0] ?? {
      total: 0,
      failures: 0,
    };
    const replay = (replayRows as Array<{ current_hour: number; previous_hour: number }>)[0] ?? {
      current_hour: 0,
      previous_hour: 0,
    };

    const failureRatePercent = metrics.total > 0 ? (metrics.failures / metrics.total) * 100 : 0;
    const dailyErrorCount = metrics.failures;
    const replayGrowth =
      replay.previous_hour >= REPLAY_RATIO_MIN_BASELINE
        ? replay.current_hour / replay.previous_hour
        : replay.current_hour > 100
          ? 10
          : 1;

    const alerted: AlertType[] = [];

    if (
      metrics.total >= WEBHOOK_FAILURE_RATE_MIN_VOLUME &&
      failureRatePercent > ALERT_THRESHOLDS.webhookFailureRateMax
    ) {
      alerted.push('failure_rate');
      alert('failure_rate', 'critical', 'Webhook failure rate above threshold', {
        failureRatePercent,
        total: metrics.total,
        failures: metrics.failures,
      });
    }

    if (dailyErrorCount > 1) {
      alerted.push('daily_error_count');
      alert('daily_error_count', 'critical', 'Webhook errors today exceed threshold', {
        dailyErrorCount,
      });
    }

    if (replayGrowth > 5) {
      alerted.push('replay_attack_suspected');
      alert('replay_attack_suspected', 'critical', 'Processed webhook events spiking', {
        currentHour: replay.current_hour,
        previousHour: replay.previous_hour,
        replayGrowth,
      });
    }

    return {
      summary: {
        failureRatePercent,
        dailyErrorCount,
        replayGrowth,
        alerted,
      },
    };
  },
};

/**
 * Counters that feed the hourly `webhook-monitoring` scheduled job
 * (`webhook_metrics`, aggregated per event type per UTC day).
 *
 * Recorded on the outcome of *processing*, not of delivery: signature
 * failures, missing-secret 503s, and replayed/already-claimed events are not
 * outcomes — Express counted those skips as failures, which inflated the rate
 * the monitor alerts on; that counting bug is not carried.
 *
 * Never throws into the caller: a metrics write must not turn a delivered
 * webhook into a 500 (and a retry storm). Failures are logged and dropped.
 */
import type { NeonQueryFunction } from '@neondatabase/serverless';

export async function recordWebhookOutcome(
  sql: NeonQueryFunction<false, false>,
  eventType: string,
  success: boolean,
  asOf: Date = new Date(),
): Promise<void> {
  try {
    await sql`
      INSERT INTO webhook_metrics (event_type, date, total_count, failure_count)
      VALUES (
        ${eventType},
        date_trunc('day', ${asOf.toISOString()}::timestamp),
        1,
        ${success ? 0 : 1}
      )
      ON CONFLICT (event_type, date) DO UPDATE SET
        total_count = webhook_metrics.total_count + 1,
        failure_count = webhook_metrics.failure_count + EXCLUDED.failure_count
    `;
  } catch (error) {
    console.error('[WEBHOOK_METRICS] failed to record outcome', {
      eventType,
      success,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

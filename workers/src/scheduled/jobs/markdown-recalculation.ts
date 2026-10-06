/**
 * `markdown-recalculation` — recompute `inventory_items.status` for every
 * organization in one set-based UPDATE (audit matrix rows 1–2).
 *
 * Express ran per-item per-org retries over the whole table every night. The
 * equivalent here is a single statement: classify by days-to-expiry, then write
 * only rows whose status actually changed (`IS DISTINCT FROM`), which keeps
 * `updated_at` honest and makes a second same-day run a no-op.
 *
 * The days math mirrors Express exactly: `Math.ceil` on millisecond difference
 * becomes `CEIL(EXTRACT(EPOCH FROM (expiry_date - asOf)) / 86400)`.
 *
 * The status whitelist is deliberate. Express overwrote *every* status,
 * resurrecting items already written off ('Processed', 'Sold Through',
 * 'Completed', 'Discarded', 'Archived' — terminal/dispositioned states). That
 * is a bug this job does not carry: only statuses this job itself produces are
 * ever touched.
 *
 * Note — every write path that names no status (the expiry list import,
 * `POST /api/inventory-items`, an expiry edit) uses `calculateInventoryStatus`
 * in `inventory-status.ts`, which is this same rule in TypeScript. The test
 * `markdown-recalculation.pglite.node.test.ts` runs both over every band edge
 * so the two cannot drift.
 */
import { MARKDOWN_WINDOWS } from '../../../../shared/domain/markdown';
import { RECALCULABLE_INVENTORY_STATUSES } from '../../inventory-status';
import type { JobContext, ScheduledJob } from '../schedule';

export const markdownRecalculationJob: ScheduledJob = {
  name: 'markdown-recalculation',
  cadence: { kind: 'daily', hourUtc: 0 },
  leaseSeconds: 600,
  async run({ sql, asOf }: JobContext) {
    const markdown3Max = MARKDOWN_WINDOWS.markdown3.maxDays;
    const markdown2Max = MARKDOWN_WINDOWS.markdown2.maxDays;
    const markdown1Max = MARKDOWN_WINDOWS.markdown1.maxDays;

    const rows = (await sql`
      WITH classified AS (
        SELECT ii.id, ii.status,
               CASE
                 WHEN days <= 0 THEN 'Expired'
                 WHEN days <= ${markdown3Max} THEN 'Markdown 3'
                 WHEN days <= ${markdown2Max} THEN 'Markdown 2'
                 WHEN days <= ${markdown1Max} THEN 'Markdown 1'
                 ELSE 'Normal'
               END AS new_status
        FROM (
          SELECT id, status,
                 CEIL(EXTRACT(EPOCH FROM (expiry_date - ${asOf.toISOString()}::timestamp)) / 86400)::int AS days
          FROM inventory_items
          WHERE status = ANY(${[...RECALCULABLE_INVENTORY_STATUSES]})
        ) ii
      ),
      updated AS (
        UPDATE inventory_items
        SET status = classified.new_status,
            updated_at = NOW()
        FROM classified
        WHERE inventory_items.id = classified.id
          AND inventory_items.status IS DISTINCT FROM classified.new_status
        RETURNING inventory_items.id
      )
      SELECT COUNT(*)::int AS updated FROM updated
    `) as Array<{ updated: number }>;

    return { summary: { updated: Number(rows[0]?.updated ?? 0) } };
  },
};

/**
 * Supplier credit-claim scheduled jobs.
 *
 * 1. Reminder engine — chases sent-but-unanswered claims. For each org, finds
 *    claims whose next follow-up time has passed and sends a follow-up nudge,
 *    advancing the schedule. This is the follow-up automation that turns an
 *    unanswered email into a recovered credit.
 * 2. Photo purge — deletes claim photos whose lifecycle window (settledAt +
 *    retention) has passed, reclaiming object storage.
 *
 * Both iterate organizations and isolate failures per claim/org so one bad row
 * never stops the batch — the same resilience posture as the other jobs.
 */

import cron, { ScheduledTask } from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { CreditClaimService } from '../services/credit-claim.service';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

async function listOrganizationIds(prisma: PrismaClient): Promise<string[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  return orgs.map((o) => o.id);
}

export async function runCreditClaimReminderJob(
  prisma: PrismaClient = getDefaultDatabaseClient(),
): Promise<{ sent: number; failed: number }> {
  Logger.info('Starting supplier credit-claim reminder job');
  let sent = 0;
  let failed = 0;

  try {
    const orgIds = await listOrganizationIds(prisma);
    for (const orgId of orgIds) {
      const service = new CreditClaimService(orgId, { prismaClient: prisma });
      const due = await service.getFollowUpDue();
      const results = await Promise.allSettled(due.map((claim) => service.sendFollowUp(claim.id)));
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          sent += 1;
        } else {
          failed += 1;
          Logger.error(
            `Follow-up failed for claim ${due[i].id} (org ${orgId}): ${String(result.reason)}`,
          );
          Sentry.captureException(result.reason, {
            level: 'error',
            tags: { job: 'credit-claim-reminder', event: 'follow-up' },
            extra: { organizationId: orgId, claimId: due[i].id },
          });
        }
      });
    }
    Logger.info('Credit-claim reminder job completed', { sent, failed });
  } catch (error) {
    Logger.error(`Credit-claim reminder job failed: ${String(error)}`);
    Sentry.captureException(error, {
      level: 'error',
      tags: { job: 'credit-claim-reminder', event: 'job-failure' },
    });
  }

  return { sent, failed };
}

export async function runCreditClaimPhotoPurgeJob(
  prisma: PrismaClient = getDefaultDatabaseClient(),
): Promise<{ purged: number }> {
  Logger.info('Starting supplier credit-claim photo-purge job');
  let purged = 0;

  try {
    const orgIds = await listOrganizationIds(prisma);
    for (const orgId of orgIds) {
      try {
        const service = new CreditClaimService(orgId, { prismaClient: prisma });
        purged += await service.purgeExpiredPhotos();
      } catch (error) {
        // Isolate per org so one org's failure never stops the rest of the batch,
        // matching the reminder job's per-claim isolation.
        Logger.error(`Credit-claim photo-purge failed for org ${orgId}: ${String(error)}`);
        Sentry.captureException(error, {
          level: 'error',
          tags: { job: 'credit-claim-photo-purge', event: 'org-failure' },
          extra: { organizationId: orgId },
        });
      }
    }
    Logger.info('Credit-claim photo-purge job completed', { purged });
  } catch (error) {
    Logger.error(`Credit-claim photo-purge job failed: ${String(error)}`);
    Sentry.captureException(error, {
      level: 'error',
      tags: { job: 'credit-claim-photo-purge', event: 'job-failure' },
    });
  }

  return { purged };
}

let reminderCron: ScheduledTask | null = null;
let purgeCron: ScheduledTask | null = null;

/** Reminder engine runs daily at 08:00; photo purge daily at 03:00. */
export function startCreditClaimJobs(): void {
  if (!reminderCron) {
    reminderCron = cron.schedule('0 8 * * *', () => {
      void runCreditClaimReminderJob();
    });
    Logger.info('Credit-claim reminder job started (daily at 08:00)');
  }
  if (!purgeCron) {
    purgeCron = cron.schedule('0 3 * * *', () => {
      void runCreditClaimPhotoPurgeJob();
    });
    Logger.info('Credit-claim photo-purge job started (daily at 03:00)');
  }
}

export function stopCreditClaimJobs(): void {
  reminderCron?.stop();
  purgeCron?.stop();
  reminderCron = null;
  purgeCron = null;
}

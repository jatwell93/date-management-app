import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getDefaultStorageProvider } from '../storage/storage-factory';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { getOrganizationId } from '../utils/auth-bypass';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';
import { NotFoundError, ValidationError } from '../errors';
import {
  CreditClaimRepository,
  type ClaimWithRelations,
} from '../repositories/credit-claim.repository';
import { SupplierCreditRepository } from '../repositories/supplier-credit.repository';
import { EmailSender, ResendEmailSender } from './email-sender';
import { renderClaimEmail } from './credit-claim-email.helpers';
import {
  expectedCredit,
  nextFollowUp,
  isChaseableClaimStatus,
  isSettledClaimStatus,
  rollupClaimablePool,
  rollupRecoveryReport,
  type RecoveryReport,
} from '../../../shared/domain/credit-claim';

/** Days a settled claim's photos are retained before the purge job deletes them. */
export const PHOTO_RETENTION_DAYS = 90;

export interface ClaimLineInput {
  expiredItemTransactionId: number;
  batchNumber?: string | null;
  unitsClaimed?: number;
}

export interface BuildClaimInput {
  supplierId: number;
  lines: ClaimLineInput[];
}

export type ClaimOutcome = 'CREDITED' | 'PARTIALLY_CREDITED' | 'REJECTED';

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Make an uploaded filename safe to embed in an object-storage key: drop any path
 * segments and reduce to a conservative charset so a crafted name can't escape the
 * claim's key prefix or create surprise nested keys. The original name is still kept
 * verbatim in the DB (photo.fileName) for display and the email attachment.
 */
function sanitizeKeySegment(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 100) || 'photo';
}

/** A candidate write-off row loaded for claim building. */
type WriteOffRow = Awaited<ReturnType<CreditClaimRepository['findWriteOffsByIds']>>[number];

/** Sum the non-null values, returning null only when no value was present (unknown ratio). */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * Validate one requested line against its write-off and compute the expected credit.
 * Extracted from buildClaim so the per-line guards live in one small, testable unit.
 */
function prepareClaimLine(
  line: ClaimLineInput,
  writeOff: WriteOffRow | undefined,
  supplier: { id: number; policyWriteOffQty: number | null; policyCreditQty: number | null },
) {
  if (!writeOff) {
    throw new NotFoundError(`Write-off ${line.expiredItemTransactionId} not found`);
  }
  if (writeOff.action !== 'expired') {
    throw new ValidationError(`Write-off ${writeOff.id} is not an expired-stock write-off.`);
  }
  if (writeOff.creditClaimLine) {
    throw new ValidationError(`Write-off ${writeOff.id} is already on a claim.`);
  }
  const product = writeOff.inventoryItem.product;
  if (product.supplierId !== supplier.id) {
    throw new ValidationError(
      `Write-off ${writeOff.id} is for a product not assigned to this supplier.`,
    );
  }

  const unitsClaimed = line.unitsClaimed ?? writeOff.unitsDiscarded ?? 0;
  if (unitsClaimed <= 0) {
    throw new ValidationError(`Write-off ${writeOff.id} has no units to claim.`);
  }

  const credit = expectedCredit(
    { writeOffQty: supplier.policyWriteOffQty, creditQty: supplier.policyCreditQty },
    unitsClaimed,
    product.costPrice ?? 0,
  );
  return {
    expiredItemTransactionId: writeOff.id,
    batchNumber: line.batchNumber?.trim() || null,
    unitsClaimed,
    expectedCreditUnits: credit.units,
    expectedCreditValue: credit.value,
  };
}

export class CreditClaimService {
  private prisma: PrismaClient;
  private repo: CreditClaimRepository;
  private supplierRepo: SupplierCreditRepository;
  private emailSender: EmailSender;
  private storage: StorageProvider;
  private organizationId: string;
  private now: () => Date;

  constructor(
    organizationId?: string,
    deps: {
      prismaClient?: PrismaClient;
      repo?: CreditClaimRepository;
      supplierRepo?: SupplierCreditRepository;
      emailSender?: EmailSender;
      storage?: StorageProvider;
      now?: () => Date;
    } = {},
  ) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = deps.prismaClient ?? getDefaultDatabaseClient();
    this.repo = deps.repo ?? new CreditClaimRepository(this.prisma);
    this.supplierRepo = deps.supplierRepo ?? new SupplierCreditRepository(this.prisma);
    this.emailSender = deps.emailSender ?? new ResendEmailSender();
    this.storage = deps.storage ?? getDefaultStorageProvider();
    this.now = deps.now ?? (() => new Date());
  }

  listClaims(statuses?: string[]): Promise<ClaimWithRelations[]> {
    return this.repo.listClaims(this.organizationId, statuses);
  }

  async getClaim(id: number): Promise<ClaimWithRelations> {
    const claim = await this.repo.findClaim(this.organizationId, id);
    if (!claim) throw new NotFoundError(`Claim ${id} not found`);
    return claim;
  }

  /**
   * Build a draft claim for one supplier from a set of write-offs. Validates every
   * write-off is claimable (belongs to the org, is an expired write-off, not already
   * claimed, and its product maps to this supplier), then snapshots expected credit
   * per line and in aggregate so a later policy/price change never rewrites the claim.
   */
  async buildClaim(input: BuildClaimInput, userId: number | null): Promise<ClaimWithRelations> {
    const supplier = await this.supplierRepo.findSupplier(this.organizationId, input.supplierId);
    if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} not found`);
    if (input.lines.length === 0) {
      throw new ValidationError('A claim needs at least one line.');
    }

    const ids = input.lines.map((l) => l.expiredItemTransactionId);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('A write-off can only appear once in a claim.');
    }

    const writeOffs = await this.repo.findWriteOffsByIds(this.organizationId, ids);
    const byId = new Map(writeOffs.map((w) => [w.id, w]));

    const lines = input.lines.map((line) =>
      prepareClaimLine(line, byId.get(line.expiredItemTransactionId), supplier),
    );
    const totalUnits = sumOrNull(lines.map((l) => l.expectedCreditUnits));
    const totalValue = sumOrNull(lines.map((l) => l.expectedCreditValue));

    return this.prisma.$transaction(async (tx) => {
      const claim = await this.repo.createClaim(
        this.organizationId,
        {
          supplierId: supplier.id,
          createdByUserId: userId,
          contactEmailSnapshot: supplier.contactEmail,
          expectedCreditUnits: totalUnits,
          expectedCreditValue: totalValue,
        },
        tx,
      );
      for (const line of lines) {
        await this.repo.createLine(this.organizationId, claim.id, line, tx);
      }
      await this.repo.addEvent(this.organizationId, claim.id, 'CREATED', userId, null, tx);
      const created = await this.repo.findClaim(this.organizationId, claim.id, tx);
      if (!created) throw new NotFoundError(`Claim ${claim.id} not found`);
      return created;
    });
  }

  /**
   * Upload a photo for a claim line via the shared storage provider (R2 in prod,
   * local in dev) and record its metadata. Only the metadata + a lifecycle deletion
   * time live in the DB; the bytes live in object storage.
   */
  async addPhoto(
    claimId: number,
    lineId: number,
    file: { buffer: Buffer; originalName: string; contentType: string },
  ) {
    const claim = await this.getClaim(claimId);
    if (claim.status !== 'DRAFT') {
      throw new ValidationError(`Photos can only be added to draft claims.`);
    }

    const line = await this.repo.findClaimLine(this.organizationId, claimId, lineId);
    if (!line) throw new NotFoundError(`Claim line ${lineId} not found`);

    const key = `credit-claims/${this.organizationId}/${claimId}/${lineId}/${randomUUID()}-${sanitizeKeySegment(file.originalName)}`;
    await this.storage.upload(key, file.buffer, file.contentType);
    return this.repo.addPhoto(this.organizationId, lineId, {
      storageKey: key,
      fileName: file.originalName,
      sizeBytes: file.buffer.length,
    });
  }

  /**
   * Send a draft claim to the supplier. Requires a line and a contact email; sets the
   * verified `sentAt` and first `nextFollowUpAt` ONLY after the provider accepts the
   * message, so the reminder engine never chases an unsent claim.
   */
  async sendClaim(id: number): Promise<ClaimWithRelations> {
    const claim = await this.getClaim(id);
    if (claim.status !== 'DRAFT') {
      throw new ValidationError(`Claim ${id} has already been sent.`);
    }
    if (claim.lines.length === 0) {
      throw new ValidationError('A claim needs at least one line before sending.');
    }
    const to = claim.contactEmailSnapshot || claim.supplier.contactEmail;
    if (!to) {
      throw new ValidationError('The supplier has no contact email; add one before sending.');
    }

    const claimed = await this.repo.claimDraftForSending(this.organizationId, id);
    if (claimed !== 1) {
      throw new ValidationError(`Claim ${id} has already been sent or is currently sending.`);
    }

    try {
      const email = renderClaimEmail(claim);
      const attachments = await this.loadAttachments(claim);
      const accepted = await this.emailSender.send({ to, ...email, attachments });
      if (!accepted) {
        throw new ValidationError('Email provider is not configured; claim was not sent.');
      }
    } catch (error) {
      await this.repo.updateClaim(this.organizationId, id, { status: 'DRAFT' });
      throw error;
    }

    const sentAt = this.now();
    const sentSnapshot = {
      ...claim,
      status: 'SENT',
      contactEmailSnapshot: to,
      sentAt,
      nextFollowUpAt: nextFollowUp(sentAt, claim.supplier.followUpDays, 0),
    } as ClaimWithRelations;
    const finalizeSentClaim = async (tx?: Parameters<CreditClaimRepository['updateClaim']>[3]) => {
      await this.repo.updateClaim(
        this.organizationId,
        id,
        {
          status: 'SENT',
          contactEmailSnapshot: to,
          sentAt,
          nextFollowUpAt: nextFollowUp(sentAt, claim.supplier.followUpDays, 0),
        },
        tx,
      );
      await this.repo.addEvent(this.organizationId, id, 'SENT', null, `Sent to ${to}`, tx);
      const updated = await this.repo.findClaim(this.organizationId, id, tx);
      if (!updated) throw new NotFoundError(`Claim ${id} not found`);
      return updated;
    };

    try {
      return await this.prisma.$transaction(async (tx) => finalizeSentClaim(tx));
    } catch (error) {
      try {
        await this.repo.updateClaim(this.organizationId, id, {
          status: sentSnapshot.status,
          contactEmailSnapshot: sentSnapshot.contactEmailSnapshot,
          sentAt: sentSnapshot.sentAt,
          nextFollowUpAt: sentSnapshot.nextFollowUpAt,
        });
        await this.repo
          .addEvent(this.organizationId, id, 'SENT', null, `Sent to ${to}`)
          .catch(() => undefined);
        const recovered = await this.repo.findClaim(this.organizationId, id);
        return recovered ?? sentSnapshot;
      } catch (compensationError) {
        // The email was already accepted, but finalize AND its compensation both failed,
        // so the claim is stuck in SENDING (sentAt still null) and can't be recovered
        // through the API. SENDING is ambiguous — auto-finalizing could double-email and
        // auto-reverting could lose an already-sent claim — so we don't guess here.
        // Surface it loudly instead of swallowing it, so ops can reconcile the one claim
        // manually, then bubble the original finalize error to the caller.
        Logger.error(
          `Claim ${id} stuck in SENDING after finalize + compensation both failed ` +
            `(org ${this.organizationId}): ${String(compensationError)}`,
        );
        Sentry.captureException(compensationError, {
          level: 'error',
          tags: { feature: 'credit-claim-send', event: 'sending-stuck' },
          extra: {
            organizationId: this.organizationId,
            claimId: id,
            originalError: String(error),
          },
        });
      }
      throw error;
    }
  }

  /** Send a follow-up nudge and advance the schedule. */
  async sendFollowUp(id: number): Promise<ClaimWithRelations> {
    const claim = await this.getClaim(id);
    if (!isChaseableClaimStatus(claim.status) || !claim.sentAt) {
      throw new ValidationError(`Claim ${id} is not awaiting a supplier response.`);
    }
    const to = claim.contactEmailSnapshot || claim.supplier.contactEmail;
    if (!to) throw new ValidationError('The supplier has no contact email.');

    const nextCount = claim.followUpCount + 1;
    const nextFollowUpAt = nextFollowUp(claim.sentAt, claim.supplier.followUpDays, nextCount);

    // Reserve this follow-up slot before sending so two runs (an overlapping cron tick,
    // or cron racing a manual nudge) can't both email the supplier — only the caller
    // that advances followUpCount from its observed value wins. Mirrors sendClaim's
    // send-once guard, keyed on the counter so it re-arms for each follow-up.
    const reserved = await this.repo.advanceFollowUp(this.organizationId, id, claim.followUpCount, {
      followUpCount: nextCount,
      nextFollowUpAt,
    });
    if (reserved !== 1) {
      throw new ValidationError(`Claim ${id} follow-up is already in progress.`);
    }

    const email = renderClaimEmail(claim, { followUp: true });
    const attachments = await this.loadAttachments(claim);
    try {
      const accepted = await this.emailSender.send({ to, ...email, attachments });
      if (!accepted) {
        throw new ValidationError('Email provider is not configured; follow-up was not sent.');
      }
    } catch (error) {
      // Send failed after reserving — roll the schedule back to what we observed so the
      // reminder engine retries this claim next run instead of silently skipping it.
      await this.repo
        .updateClaim(this.organizationId, id, {
          followUpCount: claim.followUpCount,
          nextFollowUpAt: claim.nextFollowUpAt,
        })
        .catch(() => undefined);
      throw error;
    }

    await this.repo.addEvent(this.organizationId, id, 'FOLLOW_UP_SENT', null, null);
    return this.getClaim(id);
  }

  /**
   * Record a supplier outcome. Credited/partially-credited/rejected settle the claim,
   * stop follow-ups, and schedule photo deletion after the retention window.
   */
  async recordOutcome(
    id: number,
    outcome: ClaimOutcome,
    creditedValue: number | null,
    note: string | null,
  ): Promise<ClaimWithRelations> {
    const claim = await this.getClaim(id);
    if (claim.status === 'DRAFT') {
      throw new ValidationError('Cannot record an outcome for a claim that was never sent.');
    }
    // Terminal outcomes are final. A PARTIALLY_CREDITED claim is intentionally left
    // open so a later top-up can progress it to CREDITED, so it's the one settled
    // status we still accept an outcome for.
    if (isSettledClaimStatus(claim.status) && claim.status !== 'PARTIALLY_CREDITED') {
      throw new ValidationError(
        `Claim ${id} is already settled (${claim.status}); its outcome is final.`,
      );
    }
    if (!isChaseableClaimStatus(claim.status) && claim.status !== 'PARTIALLY_CREDITED') {
      throw new ValidationError(`Claim ${id} is not awaiting a supplier outcome.`);
    }
    const settledAt = this.now();
    return this.prisma.$transaction(async (tx) => {
      await this.repo.updateClaim(
        this.organizationId,
        id,
        {
          status: outcome,
          creditedValue: outcome === 'REJECTED' ? null : creditedValue,
          settledAt,
          nextFollowUpAt: null,
        },
        tx,
      );
      await this.repo.setPhotoDeleteAfterForClaim(
        this.organizationId,
        id,
        addDays(settledAt, PHOTO_RETENTION_DAYS),
        tx,
      );
      await this.repo.addEvent(this.organizationId, id, outcome, null, note, tx);
      const updated = await this.repo.findClaim(this.organizationId, id, tx);
      if (!updated) throw new NotFoundError(`Claim ${id} not found`);
      return updated;
    });
  }

  /**
   * Recovery report: outstanding credit on open claims, per-supplier recovery rate,
   * and the value of eligible write-offs never claimed ("money left on the table",
   * derived from the claimable pool excluding the needs-supplier bucket).
   */
  async getRecoveryReport(): Promise<RecoveryReport> {
    const [claims, poolRows] = await Promise.all([
      this.repo.findSentClaimsForReport(this.organizationId),
      this.supplierRepo.findClaimableWriteOffs(this.organizationId),
    ]);

    const unclaimedValue = rollupClaimablePool(poolRows)
      .filter((group) => group.supplierId != null)
      .reduce((sum, group) => sum + group.expectedCreditValueTotal, 0);

    return rollupRecoveryReport(
      claims.map((claim) => ({
        supplierId: claim.supplierId,
        supplierName: claim.supplier.name,
        status: claim.status,
        expectedCreditValue: claim.expectedCreditValue,
        creditedValue: claim.creditedValue,
      })),
      unclaimedValue,
    );
  }

  /** Claims due for a follow-up nudge now (reminder-engine input). */
  getFollowUpDue(): Promise<ClaimWithRelations[]> {
    return this.repo.findFollowUpDue(this.organizationId, this.now());
  }

  /**
   * Delete photos whose lifecycle window has passed: remove the object-storage bytes
   * first, then the row. Best-effort per photo so one storage failure does not block
   * the rest. Returns the number of rows removed.
   */
  async purgeExpiredPhotos(): Promise<number> {
    const photos = await this.repo.findPhotosToPurge(this.organizationId, this.now());
    let purged = 0;
    for (const photo of photos) {
      try {
        try {
          await this.storage.delete(photo.storageKey);
        } catch {
          // Object may already be gone; still drop the row so it isn't retried forever.
        }
        await this.repo.deletePhoto(this.organizationId, photo.id);
        purged += 1;
      } catch (error) {
        // A transient DB failure on one row must not abort the rest of this org's
        // photos — nor, via the job loop, every later org. Skip it and report it so
        // the purge keeps its documented "one bad row never stops the batch" posture.
        Logger.error(
          `Photo purge failed for photo ${photo.id} (org ${this.organizationId}): ${String(error)}`,
        );
        Sentry.captureException(error, {
          level: 'error',
          tags: { job: 'credit-claim-photo-purge', event: 'photo-delete' },
          extra: { organizationId: this.organizationId, photoId: photo.id },
        });
      }
    }
    return purged;
  }

  private async loadAttachments(claim: ClaimWithRelations) {
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    for (const line of claim.lines) {
      for (const photo of line.photos) {
        const content = await this.storage.download(photo.storageKey);
        attachments.push({
          filename: photo.fileName,
          content,
          contentType: 'application/octet-stream',
        });
      }
    }
    return attachments;
  }
}

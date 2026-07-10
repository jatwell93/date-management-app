import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getDefaultStorageProvider } from '../storage/storage-factory';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { getOrganizationId } from '../utils/auth-bypass';
import { NotFoundError, ValidationError } from '../errors';
import {
  CreditClaimRepository,
  type ClaimWithRelations,
} from '../repositories/credit-claim.repository';
import { SupplierCreditRepository } from '../repositories/supplier-credit.repository';
import { EmailSender, ResendEmailSender } from './email-sender';
import { renderClaimEmail } from './credit-claim-email.helpers';
import { expectedCredit, nextFollowUp, isChaseableClaimStatus } from '../../../shared/domain/credit-claim';

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

    const ratio = {
      writeOffQty: supplier.policyWriteOffQty,
      creditQty: supplier.policyCreditQty,
    };

    let totalUnits: number | null = null;
    let totalValue: number | null = null;
    const lines = input.lines.map((line) => {
      const writeOff = byId.get(line.expiredItemTransactionId);
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

      const credit = expectedCredit(ratio, unitsClaimed, product.costPrice ?? 0);
      if (credit.units != null) totalUnits = (totalUnits ?? 0) + credit.units;
      if (credit.value != null) totalValue = (totalValue ?? 0) + credit.value;

      return {
        expiredItemTransactionId: writeOff.id,
        batchNumber: line.batchNumber?.trim() || null,
        unitsClaimed,
        expectedCreditUnits: credit.units,
        expectedCreditValue: credit.value,
      };
    });

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
    const line = await this.repo.findClaimLine(this.organizationId, claimId, lineId);
    if (!line) throw new NotFoundError(`Claim line ${lineId} not found`);

    const key = `credit-claims/${this.organizationId}/${claimId}/${lineId}/${randomUUID()}-${file.originalName}`;
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

    const email = renderClaimEmail(claim);
    const attachments = await this.loadAttachments(claim);
    const accepted = await this.emailSender.send({ to, ...email, attachments });
    if (!accepted) {
      throw new ValidationError('Email provider is not configured; claim was not sent.');
    }

    const sentAt = this.now();
    await this.repo.updateClaim(this.organizationId, id, {
      status: 'SENT',
      contactEmailSnapshot: to,
      sentAt,
      nextFollowUpAt: nextFollowUp(sentAt, claim.supplier.followUpDays, 0),
    });
    await this.repo.addEvent(this.organizationId, id, 'SENT', null, `Sent to ${to}`);
    return this.getClaim(id);
  }

  /** Send a follow-up nudge and advance the schedule. */
  async sendFollowUp(id: number): Promise<ClaimWithRelations> {
    const claim = await this.getClaim(id);
    if (!isChaseableClaimStatus(claim.status) || !claim.sentAt) {
      throw new ValidationError(`Claim ${id} is not awaiting a supplier response.`);
    }
    const to = claim.contactEmailSnapshot || claim.supplier.contactEmail;
    if (!to) throw new ValidationError('The supplier has no contact email.');

    const email = renderClaimEmail(claim, { followUp: true });
    const attachments = await this.loadAttachments(claim);
    const accepted = await this.emailSender.send({ to, ...email, attachments });
    if (!accepted) {
      throw new ValidationError('Email provider is not configured; follow-up was not sent.');
    }

    const nextCount = claim.followUpCount + 1;
    await this.repo.updateClaim(this.organizationId, id, {
      followUpCount: nextCount,
      nextFollowUpAt: nextFollowUp(claim.sentAt, claim.supplier.followUpDays, nextCount),
    });
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

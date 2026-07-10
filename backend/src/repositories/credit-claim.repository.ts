import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import type { CreditClaimEventType } from '../../../shared/domain/credit-claim';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ClaimLineWriteData {
  expiredItemTransactionId: number;
  batchNumber: string | null;
  unitsClaimed: number;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
}

export interface ClaimHeaderWriteData {
  supplierId: number;
  createdByUserId: number | null;
  contactEmailSnapshot: string | null;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
}

const claimInclude = {
  supplier: true,
  lines: { include: { photos: true }, orderBy: { id: 'asc' } },
  events: { orderBy: { id: 'asc' } },
} satisfies Prisma.CreditClaimInclude;

export type ClaimWithRelations = Prisma.CreditClaimGetPayload<{ include: typeof claimInclude }>;

@injectable()
export class CreditClaimRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  /**
   * Write-offs referenced by a draft claim, with their product's supplier + cost and
   * whether they are already claimed — everything the service needs to validate the
   * build and snapshot expected credit.
   */
  findWriteOffsByIds(organizationId: string, ids: number[], tx?: DbClient) {
    return this.getClient(tx).expiredItemTransaction.findMany({
      where: { organizationId, id: { in: ids } },
      include: {
        creditClaimLine: true,
        inventoryItem: { include: { product: { include: { supplier: true } } } },
      },
    });
  }

  createClaim(organizationId: string, data: ClaimHeaderWriteData, tx?: DbClient) {
    return this.getClient(tx).creditClaim.create({
      data: { organizationId, status: 'DRAFT', ...data },
    });
  }

  createLine(organizationId: string, claimId: number, line: ClaimLineWriteData, tx?: DbClient) {
    return this.getClient(tx).creditClaimLine.create({
      data: { organizationId, claimId, ...line },
    });
  }

  addEvent(
    organizationId: string,
    claimId: number,
    type: CreditClaimEventType,
    userId: number | null,
    note: string | null,
    tx?: DbClient,
  ) {
    return this.getClient(tx).creditClaimEvent.create({
      data: { organizationId, claimId, type, userId, note },
    });
  }

  findClaim(organizationId: string, id: number, tx?: DbClient): Promise<ClaimWithRelations | null> {
    return this.getClient(tx).creditClaim.findFirst({
      where: { id, organizationId },
      include: claimInclude,
    });
  }

  listClaims(
    organizationId: string,
    statuses: string[] | undefined,
    tx?: DbClient,
  ): Promise<ClaimWithRelations[]> {
    return this.getClient(tx).creditClaim.findMany({
      where: { organizationId, ...(statuses ? { status: { in: statuses } } : {}) },
      include: claimInclude,
      orderBy: { id: 'desc' },
    });
  }

  async updateClaim(
    organizationId: string,
    id: number,
    data: Prisma.CreditClaimUpdateManyMutationInput,
    tx?: DbClient,
  ): Promise<number> {
    const result = await this.getClient(tx).creditClaim.updateMany({
      where: { id, organizationId },
      data,
    });
    return result.count;
  }

  /** Schedule photo deletion for every photo on a claim (called on settlement). */
  async setPhotoDeleteAfterForClaim(
    organizationId: string,
    claimId: number,
    deleteAfter: Date,
    tx?: DbClient,
  ): Promise<void> {
    await this.getClient(tx).creditClaimPhoto.updateMany({
      where: { organizationId, claimLine: { claimId } },
      data: { deleteAfter },
    });
  }

  findClaimLine(organizationId: string, claimId: number, lineId: number, tx?: DbClient) {
    return this.getClient(tx).creditClaimLine.findFirst({
      where: { id: lineId, claimId, organizationId },
    });
  }

  addPhoto(
    organizationId: string,
    claimLineId: number,
    data: { storageKey: string; fileName: string; sizeBytes: number },
    tx?: DbClient,
  ) {
    return this.getClient(tx).creditClaimPhoto.create({
      data: { organizationId, claimLineId, ...data },
    });
  }

  /** Every claim that was ever sent (has a sentAt), with its supplier — report input. */
  findSentClaimsForReport(organizationId: string, tx?: DbClient) {
    return this.getClient(tx).creditClaim.findMany({
      where: { organizationId, sentAt: { not: null } },
      select: {
        supplierId: true,
        status: true,
        expectedCreditValue: true,
        creditedValue: true,
        supplier: { select: { name: true } },
      },
    });
  }

  /** Sent claims whose next follow-up time has passed (reminder-engine query). */
  findFollowUpDue(organizationId: string, now: Date, tx?: DbClient) {
    return this.getClient(tx).creditClaim.findMany({
      where: {
        organizationId,
        status: { in: ['SENT', 'ACKNOWLEDGED'] },
        nextFollowUpAt: { lte: now },
      },
      include: claimInclude,
      orderBy: { nextFollowUpAt: 'asc' },
    });
  }

  /** Photos whose lifecycle deletion time has passed (purge-job query). */
  findPhotosToPurge(organizationId: string, now: Date, tx?: DbClient) {
    return this.getClient(tx).creditClaimPhoto.findMany({
      where: { organizationId, deleteAfter: { lte: now } },
    });
  }

  async deletePhoto(organizationId: string, id: number, tx?: DbClient): Promise<void> {
    await this.getClient(tx).creditClaimPhoto.deleteMany({ where: { id, organizationId } });
  }
}

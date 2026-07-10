import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import type { ClaimableWriteOffRow } from '../../../shared/domain/credit-claim';

type SupplierRecord = Prisma.SupplierGetPayload<Record<string, never>>;
type DbClient = PrismaClient | Prisma.TransactionClient;

export interface SupplierWriteData {
  name: string;
  contactEmail: string | null;
  creditPolicyNote: string;
  policyWriteOffQty: number | null;
  policyCreditQty: number | null;
  followUpDays: number;
}

@injectable()
export class SupplierCreditRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  listSuppliers(organizationId: string, tx?: DbClient): Promise<SupplierRecord[]> {
    return this.getClient(tx).supplier.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  findSupplier(
    organizationId: string,
    id: number,
    tx?: DbClient,
  ): Promise<SupplierRecord | null> {
    return this.getClient(tx).supplier.findFirst({ where: { id, organizationId } });
  }

  createSupplier(
    organizationId: string,
    data: SupplierWriteData,
    tx?: DbClient,
  ): Promise<SupplierRecord> {
    return this.getClient(tx).supplier.create({ data: { organizationId, ...data } });
  }

  /** Org-scoped update; returns the number of rows changed so the service can 404. */
  async updateSupplier(
    organizationId: string,
    id: number,
    data: SupplierWriteData,
    tx?: DbClient,
  ): Promise<number> {
    const result = await this.getClient(tx).supplier.updateMany({
      where: { id, organizationId },
      data,
    });
    return result.count;
  }

  /** Assign (or clear) a product's supplier, scoped to the org. Returns rows changed. */
  async assignProductSupplier(
    organizationId: string,
    productId: number,
    supplierId: number | null,
    tx?: DbClient,
  ): Promise<number> {
    const result = await this.getClient(tx).product.updateMany({
      where: { id: productId, organizationId },
      data: { supplierId },
    });
    return result.count;
  }

  /**
   * Expired write-offs not yet attached to a claim line, joined to their product
   * and (nullable) supplier. `action = 'expired'` is the write-off marker (see
   * expired-item.service). The shared rollup groups these by supplier.
   */
  async findClaimableWriteOffs(
    organizationId: string,
    tx?: DbClient,
  ): Promise<ClaimableWriteOffRow[]> {
    const rows = await this.getClient(tx).expiredItemTransaction.findMany({
      where: {
        organizationId,
        action: 'expired',
        creditClaimLine: { is: null },
      },
      include: {
        inventoryItem: { include: { product: { include: { supplier: true } } } },
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((row) => {
      const product = row.inventoryItem.product;
      const supplier = product.supplier;
      return {
        transactionId: row.id,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? null,
        policyWriteOffQty: supplier?.policyWriteOffQty ?? null,
        policyCreditQty: supplier?.policyCreditQty ?? null,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unitsDiscarded: row.unitsDiscarded ?? 0,
        costPrice: product.costPrice ?? 0,
      };
    });
  }
}

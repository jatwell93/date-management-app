import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import type { ClaimableWriteOffRow } from '../../../shared/domain/credit-claim';
import {
  matchCatalogueEntry,
  normalizeCatalogueSku,
  type CatalogueMatchEntry,
  type CatalogueReviewState,
} from '../../../shared/domain/brand-supplier';

type SupplierRecord = Prisma.SupplierGetPayload<Record<string, never>>;
type DbClient = PrismaClient | Prisma.TransactionClient;
export type DisposeWriteOffResult = 'DISPOSED' | 'ALREADY_DISPOSED' | 'CLAIMED' | 'NOT_FOUND';
export type CorrectionReviewResult = 'UPDATED' | 'ALREADY_REVIEWED' | 'NOT_FOUND';

export interface SupplierWriteData {
  name: string;
  contactEmail: string | null;
  creditPolicyNote: string;
  policyWriteOffQty: number | null;
  policyCreditQty: number | null;
  followUpDays: number;
}

export interface BrandReviewOptions {
  state?: CatalogueReviewState;
  group?: string;
  cursor?: number;
  limit: number;
}

export interface AddBrandData {
  productId: number;
  name: string;
  supplierId: number | null;
}

export interface CatalogueEnrichmentInput {
  productId: number;
  barcode: string;
  sku: string;
}

interface CatalogueEnrichmentCandidate extends CatalogueMatchEntry {
  brandName: string;
  manufacturerName: string | null;
}

export interface CorrectionReviewOptions {
  status: string;
  cursor?: number;
  limit: number;
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

  listBrands(organizationId: string, tx?: DbClient) {
    return this.getClient(tx).brand.findMany({
      where: { organizationId },
      include: { supplier: true, _count: { select: { products: true } } },
      orderBy: [{ suggestedSupplierName: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async enrichImportedProduct(
    organizationId: string,
    input: CatalogueEnrichmentInput,
  ): Promise<void> {
    const barcode = input.barcode.trim();
    const normalizedSku = normalizeCatalogueSku(input.sku);

    await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<CatalogueEnrichmentCandidate[]>(Prisma.sql`
        SELECT id, barcode,
               api_sku AS "apiSku", sigma_sku AS "sigmaSku", ch2_sku AS "ch2Sku",
               brand_name AS "brandName", manufacturer_name AS "manufacturerName"
        FROM master_catalogue_entries
        WHERE TRIM(barcode) = ${barcode}
           OR (${normalizedSku} IS NOT NULL AND UPPER(TRIM(api_sku)) = ${normalizedSku})
           OR (${normalizedSku} IS NOT NULL AND UPPER(TRIM(sigma_sku)) = ${normalizedSku})
           OR (${normalizedSku} IS NOT NULL AND UPPER(TRIM(ch2_sku)) = ${normalizedSku})
      `);
      const entry = matchCatalogueEntry(candidates, input);

      if (!entry) {
        const existingCorrection = await tx.catalogueCorrection.findFirst({
          where: {
            organizationId,
            productId: input.productId,
            kind: 'UNMATCHED',
            status: 'PENDING',
          },
          select: { id: true },
        });
        if (!existingCorrection) {
          await tx.catalogueCorrection.create({
            data: {
              organizationId,
              productId: input.productId,
              barcode: barcode || null,
              kind: 'UNMATCHED',
              status: 'PENDING',
            },
          });
        }
        return;
      }

      let brand = await tx.brand.findUnique({
        where: { organizationId_name: { organizationId, name: entry.brandName } },
        select: { id: true, source: true },
      });
      if (!brand) {
        brand = await tx.brand.create({
          data: {
            organizationId,
            name: entry.brandName,
            manufacturerName: entry.manufacturerName,
            suggestedSupplierName: entry.manufacturerName,
            supplierId: null,
            source: 'REFERENCE',
          },
          select: { id: true, source: true },
        });
      } else if (brand.source === 'REFERENCE') {
        brand = await tx.brand.update({
          where: { id: brand.id },
          data: {
            manufacturerName: entry.manufacturerName,
            suggestedSupplierName: entry.manufacturerName,
          },
          select: { id: true, source: true },
        });
      }

      await tx.product.updateMany({
        where: { id: input.productId, organizationId },
        data: { brandId: brand.id },
      });
    });
  }

  async reviewBrands(organizationId: string, options: BrandReviewOptions, tx?: DbClient) {
    const stateWhere =
      options.state === 'NEEDS_BRAND'
        ? { brandId: null }
        : options.state === 'PENDING_CONFIRMATION'
          ? { brand: { is: { source: 'REFERENCE' } } }
          : options.state === 'CONFIRMED'
            ? {
                brand: {
                  is: { source: { in: ['USER_ADDED', 'CONFIRMED'] }, supplierId: { not: null } },
                },
              }
            : {};
    const rows = await this.getClient(tx).product.findMany({
      where: {
        organizationId,
        id: options.cursor == null ? undefined : { gt: options.cursor },
        AND: [
          stateWhere,
          ...(options.group ? [{ brand: { is: { suggestedSupplierName: options.group } } }] : []),
        ],
      },
      include: { brand: { include: { supplier: true } }, supplier: true },
      orderBy: { id: 'asc' },
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  findSupplier(organizationId: string, id: number, tx?: DbClient): Promise<SupplierRecord | null> {
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
    createdByUserId?: number,
    tx?: DbClient,
  ): Promise<number> {
    if (tx || createdByUserId == null) {
      const result = await this.getClient(tx).product.updateMany({
        where: { id: productId, organizationId },
        data: { supplierId },
      });
      return result.count;
    }

    return this.prisma.$transaction(async (transaction) => {
      const product = await transaction.product.findFirst({
        where: { id: productId, organizationId },
        include: { brand: true },
      });
      if (!product) return 0;
      const updated = await transaction.product.updateMany({
        where: { id: productId, organizationId },
        data: { supplierId },
      });
      if (updated.count === 1 && supplierId != null) {
        await transaction.catalogueCorrection.create({
          data: {
            organizationId,
            productId,
            brandId: product.brandId,
            barcode: product.barcode || null,
            enteredBrandName: product.brand?.name ?? null,
            chosenSupplierId: supplierId,
            kind: 'SUPPLIER_OVERRIDE',
            createdByUserId,
          },
        });
      }
      return updated.count;
    });
  }

  async addBrandForProduct(organizationId: string, data: AddBrandData, createdByUserId: number) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: data.productId, organizationId },
      });
      if (!product) return null;
      const brand = await tx.brand.upsert({
        where: { organizationId_name: { organizationId, name: data.name } },
        create: {
          organizationId,
          name: data.name,
          supplierId: data.supplierId,
          source: 'USER_ADDED',
        },
        update: { supplierId: data.supplierId, source: 'USER_ADDED' },
      });
      await tx.product.update({ where: { id: product.id }, data: { brandId: brand.id } });
      await tx.catalogueCorrection.create({
        data: {
          organizationId,
          productId: product.id,
          brandId: brand.id,
          barcode: product.barcode || null,
          enteredBrandName: brand.name,
          chosenSupplierId: data.supplierId,
          kind: 'BRAND_ADDED',
          createdByUserId,
        },
      });
      return brand;
    });
  }

  async confirmBrandSupplier(
    organizationId: string,
    brandId: number,
    supplierId: number,
    tx?: DbClient,
  ): Promise<number> {
    const result = await this.getClient(tx).brand.updateMany({
      where: { id: brandId, organizationId },
      data: { supplierId, source: 'CONFIRMED' },
    });
    return result.count;
  }

  findBrand(organizationId: string, brandId: number, tx?: DbClient) {
    return this.getClient(tx).brand.findFirst({
      where: { id: brandId, organizationId },
      include: { supplier: true },
    });
  }

  async listCatalogueCorrections(options: CorrectionReviewOptions, tx?: DbClient) {
    const rows = await this.getClient(tx).catalogueCorrection.findMany({
      where: {
        status: options.status,
        id: options.cursor == null ? undefined : { gt: options.cursor },
      },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { id: 'asc' },
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  async updateCatalogueCorrectionStatus(
    id: number,
    status: 'ACCEPTED' | 'REJECTED',
    tx?: DbClient,
  ): Promise<CorrectionReviewResult> {
    const client = this.getClient(tx);
    const result = await client.catalogueCorrection.updateMany({
      where: { id, status: 'PENDING' },
      data: { status },
    });
    if (result.count === 1) return 'UPDATED';
    const existing = await client.catalogueCorrection.findUnique({
      where: { id },
      select: { id: true },
    });
    return existing ? 'ALREADY_REVIEWED' : 'NOT_FOUND';
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
        creditDisposition: { not: 'DISPOSED' },
        creditClaimLine: { is: null },
      },
      include: {
        inventoryItem: {
          include: {
            product: { include: { supplier: true, brand: { include: { supplier: true } } } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((row) => {
      const product = row.inventoryItem.product;
      const supplier = product.supplier;
      const brand = product.brand;
      const brandSupplier = brand?.supplier;
      return {
        transactionId: row.id,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? null,
        policyWriteOffQty: supplier?.policyWriteOffQty ?? null,
        policyCreditQty: supplier?.policyCreditQty ?? null,
        creditPolicyNote: supplier?.creditPolicyNote ?? null,
        brandId: brand?.id ?? null,
        brandName: brand?.name ?? null,
        brandSource: brand?.source ?? null,
        suggestedSupplierName: brand?.suggestedSupplierName ?? null,
        brandSupplierId: brandSupplier?.id ?? null,
        brandSupplierName: brandSupplier?.name ?? null,
        brandPolicyWriteOffQty: brandSupplier?.policyWriteOffQty ?? null,
        brandPolicyCreditQty: brandSupplier?.policyCreditQty ?? null,
        brandCreditPolicyNote: brandSupplier?.creditPolicyNote ?? null,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unitsDiscarded: row.unitsDiscarded ?? 0,
        costPrice: product.costPrice ?? 0,
      };
    });
  }

  async disposeWriteOff(
    organizationId: string,
    transactionId: number,
  ): Promise<DisposeWriteOffResult> {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.expiredItemTransaction.findFirst({
        where: { id: transactionId, organizationId, action: 'expired' },
        select: { creditDisposition: true, creditClaimLine: { select: { id: true } } },
      });
      if (!transaction) return 'NOT_FOUND';
      if (transaction.creditClaimLine) return 'CLAIMED';
      if (transaction.creditDisposition === 'DISPOSED') return 'ALREADY_DISPOSED';

      const updated = await tx.expiredItemTransaction.updateMany({
        where: {
          id: transactionId,
          organizationId,
          creditDisposition: 'PENDING',
          creditClaimLine: { is: null },
        },
        data: { creditDisposition: 'DISPOSED' },
      });
      if (updated.count === 1) return 'DISPOSED';

      const raced = await tx.expiredItemTransaction.findFirst({
        where: { id: transactionId, organizationId },
        select: { creditDisposition: true, creditClaimLine: { select: { id: true } } },
      });
      if (raced?.creditClaimLine) return 'CLAIMED';
      return raced?.creditDisposition === 'DISPOSED' ? 'ALREADY_DISPOSED' : 'NOT_FOUND';
    });
  }
}

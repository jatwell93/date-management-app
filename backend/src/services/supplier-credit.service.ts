import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import {
  SupplierCreditRepository,
  type BrandReviewOptions,
  type CorrectionReviewOptions,
  type SupplierWriteData,
} from '../repositories/supplier-credit.repository';
import { rollupClaimablePool, type ClaimablePoolGroup } from '../../../shared/domain/credit-claim';
import { isCatalogueReviewState } from '../../../shared/domain/brand-supplier';

export interface SupplierInput {
  name: string;
  contactEmail?: string | null;
  creditPolicyNote?: string;
  policyWriteOffQty?: number | null;
  policyCreditQty?: number | null;
  followUpDays?: number;
}

export interface AddBrandInput {
  productId: number;
  name: string;
  supplierId?: number | null;
}

/**
 * Normalize API input into a full write record. A credit ratio needs *both* legs —
 * a lone write-off or credit quantity is meaningless — so we validate them as a
 * pair here (the one rule that Zod can express but we also enforce server-side).
 */
function toWriteData(input: SupplierInput): SupplierWriteData {
  const writeOffQty = input.policyWriteOffQty ?? null;
  const creditQty = input.policyCreditQty ?? null;
  if ((writeOffQty == null) !== (creditQty == null)) {
    throw new ValidationError(
      'A credit ratio needs both a write-off quantity and a credit quantity, or neither.',
    );
  }
  return {
    name: input.name.trim(),
    contactEmail: input.contactEmail?.trim() || null,
    creditPolicyNote: input.creditPolicyNote?.trim() ?? '',
    policyWriteOffQty: writeOffQty,
    policyCreditQty: creditQty,
    followUpDays: input.followUpDays ?? 7,
  };
}

export class SupplierCreditService {
  private prisma: PrismaClient;
  private repo: SupplierCreditRepository;
  private organizationId: string;

  constructor(
    organizationId?: string,
    prismaClient?: PrismaClient,
    repo?: SupplierCreditRepository,
  ) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.repo = repo ?? new SupplierCreditRepository(this.prisma);
  }

  listSuppliers() {
    return this.repo.listSuppliers(this.organizationId);
  }

  async createSupplier(input: SupplierInput) {
    return this.repo.createSupplier(this.organizationId, toWriteData(input));
  }

  async updateSupplier(id: number, input: SupplierInput) {
    const changed = await this.repo.updateSupplier(this.organizationId, id, toWriteData(input));
    if (changed === 0) {
      throw new NotFoundError(`Supplier ${id} not found`);
    }
    const supplier = await this.repo.findSupplier(this.organizationId, id);
    if (!supplier) {
      throw new NotFoundError(`Supplier ${id} not found`);
    }
    return supplier;
  }

  /**
   * Point a product at a supplier (or clear it with null). Validates the supplier
   * belongs to the org so a caller cannot leak another tenant's supplier id, then
   * confirms the product exists in the org.
   */
  async assignProductSupplier(
    productId: number,
    supplierId: number | null,
    createdByUserId?: number,
  ) {
    if (supplierId !== null) {
      const supplier = await this.repo.findSupplier(this.organizationId, supplierId);
      if (!supplier) {
        throw new NotFoundError(`Supplier ${supplierId} not found`);
      }
    }
    const changed =
      createdByUserId == null
        ? await this.repo.assignProductSupplier(this.organizationId, productId, supplierId)
        : await this.repo.assignProductSupplier(
            this.organizationId,
            productId,
            supplierId,
            createdByUserId,
          );
    if (changed === 0) {
      throw new NotFoundError(`Product ${productId} not found`);
    }
    return { productId, supplierId };
  }

  listBrands() {
    return this.repo.listBrands(this.organizationId);
  }

  reviewBrands(
    options: Omit<BrandReviewOptions, 'limit' | 'state'> & { state?: string; limit?: number },
  ) {
    if (options.state != null && !isCatalogueReviewState(options.state)) {
      throw new ValidationError(
        'Catalogue review state must be NEEDS_BRAND, PENDING_CONFIRMATION, or CONFIRMED',
      );
    }
    return this.repo.reviewBrands(this.organizationId, {
      ...options,
      state: options.state,
      limit: Math.min(100, Math.max(1, options.limit ?? 50)),
    });
  }

  async addBrand(input: AddBrandInput, createdByUserId: number) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Brand name is required');
    const supplierId = input.supplierId ?? null;
    if (supplierId != null) {
      const supplier = await this.repo.findSupplier(this.organizationId, supplierId);
      if (!supplier) throw new NotFoundError(`Supplier ${supplierId} not found`);
    }
    const brand = await this.repo.addBrandForProduct(
      this.organizationId,
      { productId: input.productId, name, supplierId },
      createdByUserId,
    );
    if (!brand) throw new NotFoundError(`Product ${input.productId} not found`);
    return brand;
  }

  async confirmBrandSupplier(brandId: number, supplierId: number) {
    const supplier = await this.repo.findSupplier(this.organizationId, supplierId);
    if (!supplier) throw new NotFoundError(`Supplier ${supplierId} not found`);
    const changed = await this.repo.confirmBrandSupplier(this.organizationId, brandId, supplierId);
    if (changed === 0) throw new NotFoundError(`Brand ${brandId} not found`);
    const brand = await this.repo.findBrand(this.organizationId, brandId);
    if (!brand) throw new NotFoundError(`Brand ${brandId} not found`);
    return brand;
  }

  listCatalogueCorrections(options: Omit<CorrectionReviewOptions, 'limit'> & { limit?: number }) {
    return this.repo.listCatalogueCorrections({
      ...options,
      limit: Math.min(100, Math.max(1, options.limit ?? 50)),
    });
  }

  async reviewCatalogueCorrection(id: number, status: 'ACCEPTED' | 'REJECTED') {
    if (status !== 'ACCEPTED' && status !== 'REJECTED') {
      throw new ValidationError('Correction status must be ACCEPTED or REJECTED');
    }
    const result = await this.repo.updateCatalogueCorrectionStatus(id, status);
    if (result === 'NOT_FOUND') throw new NotFoundError(`Catalogue correction ${id} not found`);
    if (result === 'ALREADY_REVIEWED') {
      throw new ConflictError(`Catalogue correction ${id} has already been reviewed`);
    }
    return { id, status };
  }

  /** Expired write-offs awaiting a claim, grouped by supplier (+ needs-supplier). */
  async getClaimablePool(): Promise<ClaimablePoolGroup[]> {
    const rows = await this.repo.findClaimableWriteOffs(this.organizationId);
    return rollupClaimablePool(rows);
  }

  async disposeWriteOff(transactionId: number) {
    const result = await this.repo.disposeWriteOff(this.organizationId, transactionId);
    if (result === 'NOT_FOUND') {
      throw new NotFoundError(`Expired transaction ${transactionId} not found`);
    }
    if (result === 'CLAIMED') {
      throw new ConflictError(`Expired transaction ${transactionId} has already entered a claim`);
    }
    return { transactionId, creditDisposition: 'DISPOSED' as const };
  }
}

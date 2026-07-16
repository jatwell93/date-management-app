import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { ConflictError, NotFoundError, PolicyValidationError, ValidationError } from '../errors';
import {
  SupplierCreditRepository,
  type BrandReviewOptions,
  type CorrectionReviewOptions,
  type SupplierWriteData,
} from '../repositories/supplier-credit.repository';
import { rollupClaimablePool, type ClaimablePoolGroup } from '../../../shared/domain/credit-claim';
import { isCatalogueReviewState } from '../../../shared/domain/brand-supplier';
import {
  isPolicyWrite,
  validatePolicyWrite,
  type PolicyStatus,
  type SupplierPolicyRecord,
} from '../../../shared/domain/supplier-policy';
import { assertOrgRole } from '../middleware/requireOrgRole';
import { ROLES } from '../constants/roles';

export interface SupplierInput {
  name?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  creditPolicyNote?: string;
  policyWriteOffQty?: number | null;
  policyCreditQty?: number | null;
  followUpDays?: number;
  representativeName?: string | null;
  representativeEmail?: string | null;
}

export interface PolicyReviewInput {
  brand?: string;
  supplier?: string;
  status?: PolicyStatus;
}

export interface BulkAttachInput {
  supplierId: number;
  brandIds: number[];
}

export interface BulkLinkInput {
  brandId?: number;
  brandName?: string;
  productIds: number[];
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
function normalizeText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function assertRatio(writeOffQty: number | null, creditQty: number | null): void {
  if ((writeOffQty == null) !== (creditQty == null)) {
    throw new PolicyValidationError('Supplier policy is invalid', [
      {
        field: 'policyCreditQty',
        message:
          'A credit ratio needs both a write-off quantity and a credit quantity, or neither.',
      },
    ]);
  }
}

function toCreateData(input: SupplierInput, policyChanged: boolean): SupplierWriteData {
  const writeOffQty = input.policyWriteOffQty ?? null;
  const creditQty = input.policyCreditQty ?? null;
  return {
    name: input.name?.trim() ?? '',
    contactEmail: normalizeText(input.contactEmail),
    contactPhone: normalizeText(input.contactPhone),
    creditPolicyNote: input.creditPolicyNote?.trim() ?? '',
    policyWriteOffQty: writeOffQty,
    policyCreditQty: creditQty,
    followUpDays: input.followUpDays ?? 7,
    representativeName: normalizeText(input.representativeName),
    representativeEmail: normalizeText(input.representativeEmail),
    policyUpdatedAt: policyChanged ? new Date() : null,
  };
}

function toMergedData(
  input: SupplierInput,
  existing: SupplierWriteData & { name: string },
  policyChanged: boolean,
): SupplierWriteData {
  const writeOffQty =
    input.policyWriteOffQty === undefined ? existing.policyWriteOffQty : input.policyWriteOffQty;
  const creditQty =
    input.policyCreditQty === undefined ? existing.policyCreditQty : input.policyCreditQty;
  assertRatio(writeOffQty, creditQty);
  return {
    name: input.name === undefined ? existing.name : input.name.trim(),
    contactEmail:
      input.contactEmail === undefined ? existing.contactEmail : normalizeText(input.contactEmail),
    contactPhone:
      input.contactPhone === undefined ? existing.contactPhone : normalizeText(input.contactPhone),
    creditPolicyNote:
      input.creditPolicyNote === undefined
        ? existing.creditPolicyNote
        : (normalizeText(input.creditPolicyNote) ?? ''),
    policyWriteOffQty: writeOffQty,
    policyCreditQty: creditQty,
    followUpDays: input.followUpDays ?? existing.followUpDays,
    representativeName:
      input.representativeName === undefined
        ? existing.representativeName
        : normalizeText(input.representativeName),
    representativeEmail:
      input.representativeEmail === undefined
        ? existing.representativeEmail
        : normalizeText(input.representativeEmail),
    policyUpdatedAt: policyChanged ? new Date() : existing.policyUpdatedAt,
  };
}

function authorizeAndValidatePolicy(
  input: SupplierPolicyRecord,
  existing: SupplierPolicyRecord | null,
  actorRole: string | undefined,
): boolean {
  const policyChanged = isPolicyWrite(input, existing);
  if (!policyChanged) return false;
  assertOrgRole(actorRole, ROLES.ADMIN);
  const errors = validatePolicyWrite(input, existing);
  if (errors.length) throw new PolicyValidationError('Supplier policy is invalid', errors);
  return true;
}

function normalizeBulkIds(ids: number[], field: string): number[] {
  if (ids.length < 1 || ids.length > 500 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new PolicyValidationError('Bulk request is invalid', [
      { field, message: 'Provide between 1 and 500 positive integer IDs' },
    ]);
  }
  return [...new Set(ids)];
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

  async createSupplier(input: SupplierInput, actorRole?: string) {
    return this.repo.withTransaction(async (tx) => {
      const policyChanged = authorizeAndValidatePolicy(input, null, actorRole);
      const data = toCreateData(input, policyChanged);
      assertRatio(data.policyWriteOffQty, data.policyCreditQty);
      return this.repo.createSupplier(this.organizationId, data, tx);
    });
  }

  async updateSupplier(id: number, input: SupplierInput, actorRole?: string) {
    return this.repo.withTransaction(async (tx) => {
      const existing = await this.repo.findSupplier(this.organizationId, id, tx);
      if (!existing) throw new NotFoundError(`Supplier ${id} not found`);
      const policyChanged = authorizeAndValidatePolicy(input, existing, actorRole);
      const changed = await this.repo.updateSupplier(
        this.organizationId,
        id,
        toMergedData(input, existing, policyChanged),
        tx,
      );
      if (changed === 0) throw new NotFoundError(`Supplier ${id} not found`);
      const supplier = await this.repo.findSupplier(this.organizationId, id, tx);
      if (!supplier) throw new NotFoundError(`Supplier ${id} not found`);
      return supplier;
    });
  }

  async replaceSupplier(id: number, input: SupplierInput, actorRole?: string) {
    return this.repo.withTransaction(async (tx) => {
      const existing = await this.repo.findSupplier(this.organizationId, id, tx);
      if (!existing) throw new NotFoundError(`Supplier ${id} not found`);
      const replacement = toCreateData(input, false);
      const policyChanged = authorizeAndValidatePolicy(replacement, existing, actorRole);
      assertRatio(replacement.policyWriteOffQty, replacement.policyCreditQty);
      const changed = await this.repo.updateSupplier(
        this.organizationId,
        id,
        { ...replacement, policyUpdatedAt: policyChanged ? new Date() : existing.policyUpdatedAt },
        tx,
      );
      if (changed === 0) throw new NotFoundError(`Supplier ${id} not found`);
      const supplier = await this.repo.findSupplier(this.organizationId, id, tx);
      if (!supplier) throw new NotFoundError(`Supplier ${id} not found`);
      return supplier;
    });
  }

  async clearSupplierPolicy(id: number, actorRole?: string) {
    assertOrgRole(actorRole, ROLES.ADMIN);
    return await this.repo.withTransaction(async (tx) => {
      const supplier = await this.repo.clearSupplierPolicy(this.organizationId, id, new Date(), tx);
      if (!supplier) throw new NotFoundError(`Supplier ${id} not found`);
      return supplier;
    });
  }

  listPolicyReview(options: PolicyReviewInput) {
    return this.repo.listPolicyReview(this.organizationId, options);
  }

  async bulkAttachPolicy(
    input: BulkAttachInput,
    actorRole: string | undefined,
    createdByUserId: number,
  ) {
    assertOrgRole(actorRole, ROLES.ADMIN);
    if (!Number.isInteger(input.supplierId) || input.supplierId <= 0) {
      throw new PolicyValidationError('Bulk request is invalid', [
        { field: 'supplierId', message: 'Supplier ID must be a positive integer' },
      ]);
    }
    const brandIds = normalizeBulkIds(input.brandIds, 'brandIds');
    return await this.repo.withTransaction((tx) =>
      this.repo.bulkAttachSupplier(
        this.organizationId,
        input.supplierId,
        brandIds,
        createdByUserId,
        tx,
      ),
    );
  }

  async bulkLinkProducts(input: BulkLinkInput, createdByUserId: number) {
    const productIds = normalizeBulkIds(input.productIds, 'productIds');
    const brandName = normalizeText(input.brandName);
    if ((input.brandId == null) === (brandName == null)) {
      throw new PolicyValidationError('Bulk request is invalid', [
        { field: 'brand', message: 'Provide exactly one brandId or brandName' },
      ]);
    }
    if (input.brandId != null && (!Number.isInteger(input.brandId) || input.brandId <= 0)) {
      throw new PolicyValidationError('Bulk request is invalid', [
        { field: 'brandId', message: 'Brand ID must be a positive integer' },
      ]);
    }
    return await this.repo.withTransaction((tx) =>
      this.repo.bulkLinkProducts(
        this.organizationId,
        { brandId: input.brandId, brandName: brandName ?? undefined },
        productIds,
        createdByUserId,
        tx,
      ),
    );
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

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { NotFoundError, ValidationError } from '../errors';
import {
  SupplierCreditRepository,
  type SupplierWriteData,
} from '../repositories/supplier-credit.repository';
import { rollupClaimablePool, type ClaimablePoolGroup } from '../../../shared/domain/credit-claim';

export interface SupplierInput {
  name: string;
  contactEmail?: string | null;
  creditPolicyNote?: string;
  policyWriteOffQty?: number | null;
  policyCreditQty?: number | null;
  followUpDays?: number;
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
  async assignProductSupplier(productId: number, supplierId: number | null) {
    if (supplierId !== null) {
      const supplier = await this.repo.findSupplier(this.organizationId, supplierId);
      if (!supplier) {
        throw new NotFoundError(`Supplier ${supplierId} not found`);
      }
    }
    const changed = await this.repo.assignProductSupplier(
      this.organizationId,
      productId,
      supplierId,
    );
    if (changed === 0) {
      throw new NotFoundError(`Product ${productId} not found`);
    }
    return { productId, supplierId };
  }

  /** Expired write-offs awaiting a claim, grouped by supplier (+ needs-supplier). */
  async getClaimablePool(): Promise<ClaimablePoolGroup[]> {
    const rows = await this.repo.findClaimableWriteOffs(this.organizationId);
    return rollupClaimablePool(rows);
  }
}

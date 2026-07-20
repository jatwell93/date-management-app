import { PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';
import { SupplierCreditService } from '../../services/supplier-credit.service';

describe('supplier policy Express database contracts', () => {
  const prisma = new PrismaClient();
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: number;
  let service: SupplierCreditService;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    organizationId = `policy-org-${suffix}`;
    otherOrganizationId = `policy-other-${suffix}`;
    await prisma.organization.createMany({
      data: [
        { id: organizationId, name: 'Policy Org', slug: organizationId },
        { id: otherOrganizationId, name: 'Other Org', slug: otherOrganizationId },
      ],
    });
    const user = await prisma.user.create({
      data: {
        organizationId,
        email: `policy-${suffix}@example.com`,
        username: `policy-${suffix}`,
        role: 'admin',
      },
    });
    userId = user.id;
    service = new SupplierCreditService(
      organizationId,
      prisma,
      new SupplierCreditRepository(prisma),
    );
  });

  afterEach(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('bulk-attaches atomically, reports no-ops, and records one correction per change', async () => {
    const supplier = await prisma.supplier.create({
      data: {
        organizationId,
        name: 'Policy Supplier',
        creditPolicyNote: 'Return monthly',
        contactPhone: '02 1234 5678',
      },
    });
    const [first, second] = await Promise.all([
      prisma.brand.create({ data: { organizationId, name: 'First' } }),
      prisma.brand.create({ data: { organizationId, name: 'Second', supplierId: supplier.id } }),
    ]);

    await expect(
      service.bulkAttachPolicy(
        { supplierId: supplier.id, brandIds: [first.id, second.id] },
        'admin',
        userId,
      ),
    ).resolves.toEqual({ attached: 1, unchanged: 1, corrections: 1 });

    expect(
      await prisma.catalogueCorrection.count({
        where: { organizationId, kind: 'SUPPLIER_OVERRIDE', chosenSupplierId: supplier.id },
      }),
    ).toBe(1);
  });

  it('does not partially attach when any selected brand is outside the organization', async () => {
    const supplier = await prisma.supplier.create({
      data: { organizationId, name: 'Supplier', creditPolicyNote: 'Return monthly' },
    });
    const localBrand = await prisma.brand.create({ data: { organizationId, name: 'Local' } });
    const foreignBrand = await prisma.brand.create({
      data: { organizationId: otherOrganizationId, name: 'Foreign' },
    });

    await expect(
      service.bulkAttachPolicy(
        { supplierId: supplier.id, brandIds: [localBrand.id, foreignBrand.id] },
        'admin',
        userId,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await prisma.brand.findUnique({ where: { id: localBrand.id } })).toMatchObject({
      supplierId: null,
    });
  });

  it('rolls back every SKU link when one product belongs to a different brand', async () => {
    const [target, different] = await Promise.all([
      prisma.brand.create({ data: { organizationId, name: 'Target' } }),
      prisma.brand.create({ data: { organizationId, name: 'Different' } }),
    ]);
    const [unmatched, conflicting] = await Promise.all([
      prisma.product.create({
        data: { organizationId, sku: 'UNMATCHED', barcode: 'U-1', name: 'Unmatched', costPrice: 1 },
      }),
      prisma.product.create({
        data: {
          organizationId,
          sku: 'CONFLICT',
          barcode: 'C-1',
          name: 'Conflict',
          costPrice: 1,
          brandId: different.id,
        },
      }),
    ]);

    await expect(
      service.bulkLinkProducts(
        { brandId: target.id, productIds: [unmatched.id, conflicting.id] },
        userId,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await prisma.product.findUnique({ where: { id: unmatched.id } })).toMatchObject({
      brandId: null,
    });
    expect(await prisma.catalogueCorrection.count({ where: { organizationId } })).toBe(0);
  });

  it('links unmatched SKUs while reporting target-brand products as already linked', async () => {
    const brand = await prisma.brand.create({ data: { organizationId, name: 'Target' } });
    const [unmatched, linked] = await Promise.all([
      prisma.product.create({
        data: { organizationId, sku: 'NEW', barcode: 'N-1', name: 'New', costPrice: 1 },
      }),
      prisma.product.create({
        data: {
          organizationId,
          sku: 'LINKED',
          barcode: 'L-1',
          name: 'Linked',
          costPrice: 1,
          brandId: brand.id,
        },
      }),
    ]);

    await expect(
      service.bulkLinkProducts(
        { brandId: brand.id, productIds: [unmatched.id, linked.id] },
        userId,
      ),
    ).resolves.toEqual({ brandId: brand.id, linked: 1, alreadyLinked: 1, corrections: 1 });

    expect(
      await prisma.catalogueCorrection.count({
        where: { organizationId, productId: unmatched.id, kind: 'BRAND_ADDED' },
      }),
    ).toBe(1);
  });
});

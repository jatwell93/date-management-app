import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import {
  SeedService,
  normalizeMasterCatalogueRows,
  parseMasterCatalogueWorkbook,
} from '../../services/seed.service';

const prisma = new PrismaClient();

describe('SeedService', () => {
  let service: SeedService;
  let testOrgId: string;

  beforeEach(async () => {
    await prisma.masterCatalogueEntry.deleteMany();
    // Create a test organization
    const org = await prisma.organization.create({
      data: {
        name: 'Seed Test Org',
        slug: `seed-test-${Date.now()}-${Math.random()}`,
        clerkOrganizationId: `clerk_seed_test_${Date.now()}-${Math.random()}`,
      },
    });
    testOrgId = org.id;
    service = new SeedService(prisma);
  });

  afterEach(async () => {
    // Clean up test organization and related data
    try {
      await prisma.organization.delete({
        where: { id: testOrgId },
      });
    } catch (error) {
      // Ignore if already deleted or cascaded
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds demo data successfully', async () => {
    const result = await service.seedDemoData(testOrgId);

    expect(result.success).toBe(true);
    expect(result.productsCreated).toBe(8);
    expect(result.areasCreated).toBe(3);
    expect(result.inventoryItemsCreated).toBe(8);

    // Verify in DB
    const productsCount = await prisma.product.count({
      where: { organizationId: testOrgId },
    });
    expect(productsCount).toBe(8);

    const areasCount = await prisma.storeArea.count({
      where: { organizationId: testOrgId },
    });
    expect(areasCount).toBe(3);

    const inventoryCount = await prisma.inventoryItem.count({
      where: { organizationId: testOrgId },
    });
    expect(inventoryCount).toBe(8);
  });

  it('is idempotent (can be called multiple times)', async () => {
    // First call
    const firstResult = await service.seedDemoData(testOrgId);
    expect(firstResult.productsCreated).toBe(8);
    expect(firstResult.areasCreated).toBe(3);

    // Second call should report 0 newly created
    const result = await service.seedDemoData(testOrgId);

    expect(result.success).toBe(true);
    expect(result.productsCreated).toBe(0);
    expect(result.areasCreated).toBe(0);
    expect(result.inventoryItemsCreated).toBe(0);

    // Counts in DB should stay the same
    const productsCount = await prisma.product.count({
      where: { organizationId: testOrgId },
    });
    expect(productsCount).toBe(8);

    const inventoryCount = await prisma.inventoryItem.count({
      where: { organizationId: testOrgId },
    });
    expect(inventoryCount).toBe(8);
  });

  it('parses and normalizes the checked-in 100-row catalogue sample', () => {
    const workbookPath = path.resolve(
      __dirname,
      '../../../../supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
    );
    const parsed = parseMasterCatalogueWorkbook(workbookPath);

    expect(parsed.entries).toHaveLength(99);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries[0]).toMatchObject({
      barcode: '9321299800449',
      apiSku: '192418',
      sigmaSku: '10031800',
      ch2Sku: null,
      brandName: 'THE CANCER COUNCIL',
      manufacturerName: 'VITALITY BRANDS WORLDWIDE',
      rrp: 19.99,
      metroPrice: 19.49,
    });
  });

  it('counts blank and malformed catalogue rows without inventing values', () => {
    const normalized = normalizeMasterCatalogueRows([
      ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'],
      ['Valid product', ' api-1 ', '', '', ' 9300000000001 ', ' Valid Brand '],
      [],
      ['Missing barcode', 'api-2', '', '', '', 'Brand'],
    ]);

    expect(normalized.entries).toEqual([
      expect.objectContaining({
        description: 'Valid product',
        apiSku: 'API-1',
        sigmaSku: null,
        ch2Sku: null,
        barcode: '9300000000001',
        brandName: 'Valid Brand',
      }),
    ]);
    expect(normalized.skipped).toBe(1);
    expect(normalized.errors).toHaveLength(1);
  });

  it('upserts the workbook by barcode on idempotent reruns', async () => {
    const workbookPath = path.resolve(
      __dirname,
      '../../../../supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
    );
    const first = await service.seedMasterCatalogue(workbookPath);
    const second = await service.seedMasterCatalogue(workbookPath);

    expect(first).toMatchObject({ inserted: 99, updated: 0, skipped: 0, errors: [] });
    expect(second).toMatchObject({ inserted: 0, updated: 0, skipped: 99, errors: [] });
    await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(99);
  });

  it('counts only changed catalogue records as updates', async () => {
    const workbookPath = path.resolve(
      __dirname,
      '../../../../supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
    );
    await service.seedMasterCatalogue(workbookPath);
    const row = await prisma.masterCatalogueEntry.findFirstOrThrow();
    await prisma.masterCatalogueEntry.update({
      where: { id: row.id },
      data: { description: 'Stale description' },
    });

    const result = await service.seedMasterCatalogue(workbookPath);

    expect(result).toMatchObject({ inserted: 0, updated: 1, skipped: 98, errors: [] });
    await expect(
      prisma.masterCatalogueEntry.findUnique({ where: { id: row.id } }),
    ).resolves.not.toMatchObject({ description: 'Stale description' });
  });
});

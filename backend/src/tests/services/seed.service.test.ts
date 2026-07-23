import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  SeedService,
  normalizeMasterCatalogueRows,
  parseMasterCatalogueWorkbook,
} from '../../services/seed.service';

const prisma = new PrismaClient();

function writeCatalogueWorkbook(rows: unknown[][]): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Catalogue');
  const workbookPath = path.join(os.tmpdir(), `catalogue-seed-${Date.now()}-${Math.random()}.xlsx`);
  XLSX.writeFile(workbook, workbookPath);
  return workbookPath;
}

describe('SeedService', () => {
  let service: SeedService;
  let testOrgId: string;

  beforeEach(async () => {
    await prisma.catalogueSeedRun.deleteMany();
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

    expect(first).toMatchObject({
      inserted: 99,
      updated: 0,
      unchanged: 0,
      skippedBlankRows: 0,
      retired: 0,
      reinstated: 0,
      dryRun: false,
      errors: [],
    });
    expect(second).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 99,
      skippedBlankRows: 0,
      retired: 0,
      reinstated: 0,
      dryRun: false,
      errors: [],
    });
    await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(99);
    await expect(
      prisma.catalogueSeedRun.findMany({ orderBy: { version: 'asc' } }),
    ).resolves.toMatchObject([
      { version: 1, inserted: 99, unchanged: 0, sourceFileName: path.basename(workbookPath) },
      { version: 2, inserted: 0, unchanged: 99, sourceFileName: path.basename(workbookPath) },
    ]);
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

    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 98, errors: [] });
    await expect(
      prisma.masterCatalogueEntry.findUnique({ where: { id: row.id } }),
    ).resolves.not.toMatchObject({ description: 'Stale description' });
  });

  it('retires omitted entries and reinstates the same row when they return', async () => {
    const headers = ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'];
    const fullWorkbook = writeCatalogueWorkbook([
      headers,
      ['One', 'API-1', '', '', '9300000000001', 'Brand'],
      ['Two', 'API-2', '', '', '9300000000002', 'Brand'],
    ]);
    const reducedWorkbook = writeCatalogueWorkbook([
      headers,
      ['One', 'API-1', '', '', '9300000000001', 'Brand'],
    ]);
    await service.seedMasterCatalogue(fullWorkbook);
    const returning = await prisma.masterCatalogueEntry.findUniqueOrThrow({
      where: { barcode: '9300000000002' },
    });

    const retired = await service.seedMasterCatalogue(reducedWorkbook, {
      confirmRetirements: true,
    });
    expect(retired).toMatchObject({
      retired: 1,
      retiredBarcodes: ['9300000000002'],
      reinstated: 0,
    });
    await expect(
      prisma.masterCatalogueEntry.findUniqueOrThrow({ where: { id: returning.id } }),
    ).resolves.toMatchObject({ retiredAt: expect.any(Date) });

    const reinstated = await service.seedMasterCatalogue(fullWorkbook);
    expect(reinstated).toMatchObject({ retired: 0, reinstated: 1 });
    await expect(
      prisma.masterCatalogueEntry.findUniqueOrThrow({ where: { id: returning.id } }),
    ).resolves.toMatchObject({ retiredAt: null });

    fs.rmSync(fullWorkbook);
    fs.rmSync(reducedWorkbook);
  });

  it('reports validation errors in dry-run and aborts a live duplicate workbook before writes', async () => {
    const workbookPath = writeCatalogueWorkbook([
      ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'],
      ['One', 'API-1', '', '', ' 9300000000001 ', 'Brand'],
      [],
      ['Duplicate', 'API-2', '', '', '9300000000001', 'Brand'],
      ['Malformed', 'API-3', '', '', '', 'Brand'],
    ]);

    const dryRun = await service.seedMasterCatalogue(workbookPath, { dryRun: true });
    expect(dryRun).toMatchObject({
      dryRun: true,
      skippedBlankRows: 1,
      errorCount: 2,
      inserted: 1,
    });
    await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(0);
    await expect(prisma.catalogueSeedRun.count()).resolves.toBe(0);

    await expect(service.seedMasterCatalogue(workbookPath)).rejects.toMatchObject({
      name: 'CatalogueSeedValidationError',
      result: expect.objectContaining({ errorCount: 2 }),
    });
    await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(0);
    await expect(prisma.catalogueSeedRun.count()).resolves.toBe(0);
    fs.rmSync(workbookPath);
  });

  it('rolls back catalogue writes when provenance insertion fails', async () => {
    const workbookPath = writeCatalogueWorkbook([
      ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'],
      ['One', 'API-1', '', '', '9300000000001', 'Brand'],
    ]);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_catalogue_seed_provenance
      BEFORE INSERT ON catalogue_seed_runs
      BEGIN
        SELECT RAISE(ABORT, 'Injected provenance failure');
      END
    `);

    try {
      await expect(service.seedMasterCatalogue(workbookPath)).rejects.toThrow();
      await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(0);
      await expect(prisma.catalogueSeedRun.count()).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_catalogue_seed_provenance');
      fs.rmSync(workbookPath);
    }
  });

  it('seeds a production-sized workbook within the explicit transaction window', async () => {
    const headers = ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'];
    const workbookPath = writeCatalogueWorkbook([
      headers,
      ...Array.from({ length: 7000 }, (_, index) => [
        `Product ${index}`,
        `API-${index}`,
        '',
        '',
        String(9300000000000 + index),
        'Scale Brand',
      ]),
    ]);

    try {
      await expect(service.seedMasterCatalogue(workbookPath)).resolves.toMatchObject({
        inserted: 7000,
        unchanged: 0,
        retired: 0,
      });
      await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(7000);
      await expect(prisma.catalogueSeedRun.count()).resolves.toBe(1);
    } finally {
      fs.rmSync(workbookPath);
    }
  }, 30_000);

  it('allows the checked-in sample workbook for a production dry-run only', async () => {
    const workbookPath = path.resolve(
      __dirname,
      '../../../../supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
    );
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(
        service.seedMasterCatalogue(workbookPath, { dryRun: true }),
      ).resolves.toMatchObject({
        dryRun: true,
        inserted: 99,
      });
      await expect(service.seedMasterCatalogue(workbookPath)).rejects.toThrow(
        'sample workbook cannot be used',
      );
      await expect(prisma.masterCatalogueEntry.count()).resolves.toBe(0);
      await expect(prisma.catalogueSeedRun.count()).resolves.toBe(0);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('enforces strict retirement threshold configuration without writes', async () => {
    const workbookPath = writeCatalogueWorkbook([
      ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'],
      ['One', 'API-1', '', '', '9300000000001', 'Brand'],
      ['Two', 'API-2', '', '', '9300000000002', 'Brand'],
    ]);
    await service.seedMasterCatalogue(workbookPath);
    const reducedWorkbook = writeCatalogueWorkbook([
      ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'],
      ['One', 'API-1', '', '', '9300000000001', 'Brand'],
    ]);
    const previousThreshold = process.env.MASTER_CATALOGUE_RETIREMENT_THRESHOLD;
    process.env.MASTER_CATALOGUE_RETIREMENT_THRESHOLD = '0.49';
    try {
      await expect(service.seedMasterCatalogue(reducedWorkbook)).rejects.toMatchObject({
        name: 'RetirementThresholdExceeded',
        retired: 1,
        activeBefore: 2,
        proportion: 0.5,
        threshold: 0.49,
      });
      await expect(prisma.catalogueSeedRun.count()).resolves.toBe(1);
      await expect(
        prisma.masterCatalogueEntry.count({ where: { retiredAt: { not: null } } }),
      ).resolves.toBe(0);

      process.env.MASTER_CATALOGUE_RETIREMENT_THRESHOLD = 'not-a-number';
      await expect(service.seedMasterCatalogue(reducedWorkbook)).rejects.toThrow(
        'MASTER_CATALOGUE_RETIREMENT_THRESHOLD',
      );
    } finally {
      if (previousThreshold === undefined) {
        delete process.env.MASTER_CATALOGUE_RETIREMENT_THRESHOLD;
      } else {
        process.env.MASTER_CATALOGUE_RETIREMENT_THRESHOLD = previousThreshold;
      }
      fs.rmSync(workbookPath);
      fs.rmSync(reducedWorkbook);
    }
  });
});

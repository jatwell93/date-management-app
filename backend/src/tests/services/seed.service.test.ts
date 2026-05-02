import { PrismaClient } from '@prisma/client';
import { SeedService } from '../../services/seed.service';

const prisma = new PrismaClient();

describe('SeedService', () => {
  let service: SeedService;
  let testOrgId: string;

  beforeEach(async () => {
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
    await service.seedDemoData(testOrgId);

    // Call it a second time
    const result = await service.seedDemoData(testOrgId);

    expect(result.success).toBe(true);
    // Counts should stay same
    const productsCount = await prisma.product.count({
      where: { organizationId: testOrgId },
    });
    expect(productsCount).toBe(8);

    const inventoryCount = await prisma.inventoryItem.count({
      where: { organizationId: testOrgId },
    });
    expect(inventoryCount).toBe(8);
  });
});

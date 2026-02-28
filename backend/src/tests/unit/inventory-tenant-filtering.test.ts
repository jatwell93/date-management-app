import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../../services/inventory.service';

describe('InventoryService - Tenant Filtering Optimization', () => {
  let prisma: PrismaClient;
  let service1: InventoryService;
  let service2: InventoryService;
  let org1Id: string;
  let org2Id: string;
  let product1Id: number;
  let product2Id: number;
  let location1Id: number;
  let location2Id: number;

  beforeEach(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./test.db',
        },
      },
    });

    // Create two test organizations
    org1Id = `org1-${Date.now()}`;
    org2Id = `org2-${Date.now()}`;
    
    await prisma.organization.createMany({
      data: [
        { id: org1Id, name: 'Org 1', slug: `org1-${Date.now()}`, contactEmail: 'org1@test.com' },
        { id: org2Id, name: 'Org 2', slug: `org2-${Date.now()}`, contactEmail: 'org2@test.com' },
      ],
    });

    // Create products for each organization
    const product1 = await prisma.product.create({
      data: {
        organizationId: org1Id,
        sku: 'ORG1-001',
        barcode: '111111111',
        name: 'Product 1',
        costPrice: 10.0,
      },
    });
    product1Id = product1.id;

    const product2 = await prisma.product.create({
      data: {
        organizationId: org2Id,
        sku: 'ORG2-001',
        barcode: '222222222',
        name: 'Product 2',
        costPrice: 20.0,
      },
    });
    product2Id = product2.id;

    // Create locations for each organization
    const location1 = await prisma.storeArea.create({
      data: {
        organizationId: org1Id,
        name: 'Store 1',
        subDepartment: 'Dept 1',
      },
    });
    location1Id = location1.id;

    const location2 = await prisma.storeArea.create({
      data: {
        organizationId: org2Id,
        name: 'Store 2',
        subDepartment: 'Dept 2',
      },
    });
    location2Id = location2.id;

    service1 = new InventoryService(org1Id, prisma);
    service2 = new InventoryService(org2Id, prisma);
  });

  afterEach(async () => {
    // Clean up
    await prisma.inventoryItem.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await prisma.product.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await prisma.storeArea.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org1Id, org2Id] } },
    });
    await prisma.$disconnect();
  });

  it('should only return items for the correct organization', async () => {
    // Create items for both organizations
    await prisma.inventoryItem.create({
      data: {
        organizationId: org1Id,
        productId: product1Id,
        locationId: location1Id,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'Normal',
      },
    });

    await prisma.inventoryItem.create({
      data: {
        organizationId: org2Id,
        productId: product2Id,
        locationId: location2Id,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'Normal',
      },
    });

    // Service 1 should only see org1 items
    const items1 = await service1.getAllInventoryItems();
    expect(items1).toHaveLength(1);
    expect(items1[0].productId).toBe(product1Id);

    // Service 2 should only see org2 items
    const items2 = await service2.getAllInventoryItems();
    expect(items2).toHaveLength(1);
    expect(items2[0].productId).toBe(product2Id);
  });

  it('should enforce tenant isolation when getting by ID', async () => {
    // Create an item for org1
    const item = await prisma.inventoryItem.create({
      data: {
        organizationId: org1Id,
        productId: product1Id,
        locationId: location1Id,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'Normal',
      },
    });

    // Service 1 should find the item
    const found1 = await service1.getInventoryItemById(item.id);
    expect(found1).not.toBeNull();
    expect(found1?.productId).toBe(product1Id);

    // Service 2 should not find the item
    const found2 = await service2.getInventoryItemById(item.id);
    expect(found2).toBeNull();
  });

  it('should filter items by location within organization', async () => {
    // Create items at different locations
    await prisma.inventoryItem.create({
      data: {
        organizationId: org1Id,
        productId: product1Id,
        locationId: location1Id,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'Normal',
      },
    });

    // Create item in org2 at location2
    await prisma.inventoryItem.create({
      data: {
        organizationId: org2Id,
        productId: product2Id,
        locationId: location2Id,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'Normal',
      },
    });

    // Service 1 should find items at location1
    const items1 = await service1.getInventoryItemsByLocationId(location1Id);
    expect(items1).toHaveLength(1);

    // Service 2 should not find items at location1 (wrong org)
    const items2 = await service2.getInventoryItemsByLocationId(location1Id);
    expect(items2).toHaveLength(0);
  });

  it('should filter items by product within organization', async () => {
    // Create items for different products
    await prisma.inventoryItem.create({
      data: {
        organizationId: org1Id,
        productId: product1Id,
        locationId: location1Id,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'Normal',
      },
    });

    // Service 1 should find items for product1
    const items1 = await service1.getInventoryItemsByProductId(product1Id);
    expect(items1).toHaveLength(1);

    // Service 2 should not find items for product1 (wrong org)
    const items2 = await service2.getInventoryItemsByProductId(product1Id);
    expect(items2).toHaveLength(0);
  });
});

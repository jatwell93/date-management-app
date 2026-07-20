import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../../services/inventory.service';

describe('InventoryService - createInventoryItem Status Handling', () => {
  let prisma: PrismaClient;
  let service: InventoryService;
  let orgId: string;
  let productId: number;
  let locationId: number;
  let userId: number;

  beforeEach(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./test.db',
        },
      },
    });

    // Create test organization
    orgId = `org-${Date.now()}`;
    await prisma.organization.create({
      data: {
        id: orgId,
        name: 'Test Org',
        slug: `test-org-${Date.now()}`,
        contactEmail: 'test@example.com',
      },
    });

    // Create test user
    const user = await prisma.user.create({
      data: {
        clerkUserId: `user_${Date.now()}`,
        email: 'test@example.com',
        username: 'testuser',
        role: 'user',
        organizationId: orgId,
      },
    });
    userId = user.id;

    // Create test product
    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: 'TEST-001',
        barcode: '123456789',
        name: 'Test Product',
        costPrice: 10.0,
      },
    });
    productId = product.id;

    // Create test store area
    const location = await prisma.storeArea.create({
      data: {
        organizationId: orgId,
        name: 'Test Store',
        subDepartment: 'Test Dept',
      },
    });
    locationId = location.id;

    // Create organization usage record
    await prisma.organizationUsage.create({
      data: {
        organizationId: orgId,
        activeUsers: 0,
        maxUsers: 10,
        totalSkus: 0,
        maxSkus: 1000,
        totalInventoryItems: 0,
        storageUsedBytes: 0,
      },
    });

    service = new InventoryService(orgId, prisma);
  });

  afterEach(async () => {
    // Clean up
    await prisma.inventoryItem.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.product.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.storeArea.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.user.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.organizationUsage.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.organization.deleteMany({
      where: { id: orgId },
    });
    await prisma.$disconnect();
  });

  it('should use provided status when creating inventory item', async () => {
    const expiryDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days from now
    const item = await service.createInventoryItem(
      {
        productId,
        expiryDate,
        locationId,
        status: 'Markdown 1', // Explicitly set status
      },
      userId,
    );

    expect(item.status).toBe('Markdown 1');
  });

  it('should calculate status when not provided', async () => {
    const expiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days from now
    const item = await service.createInventoryItem(
      {
        productId,
        expiryDate,
        locationId,
        // No status provided
      },
      userId,
    );

    // Should be Markdown 3 based on 5 days (within the 0-30 day window)
    expect(item.status).toBe('Markdown 3');
  });

  it('should handle expired items correctly', async () => {
    const expiryDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Yesterday
    const item = await service.createInventoryItem(
      {
        productId,
        expiryDate,
        locationId,
        // No status provided
      },
      userId,
    );

    expect(item.status).toBe('Expired');
  });

  it('should handle normal items correctly', async () => {
    const expiryDate = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(); // 120 days from now (beyond the 90-day markdown window)
    const item = await service.createInventoryItem(
      {
        productId,
        expiryDate,
        locationId,
        // No status provided
      },
      userId,
    );

    expect(item.status).toBe('Normal');
  });

  it('should create audit log with correct status', async () => {
    const expiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days from now
    await service.createInventoryItem(
      {
        productId,
        expiryDate,
        locationId,
      },
      userId,
    );

    // Check audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        organizationId: orgId,
        action: 'inventory_changed',
      },
    });

    expect(auditLog).not.toBeNull();
    expect(auditLog?.changeDescription).toContain('status Markdown 3');
  });
});

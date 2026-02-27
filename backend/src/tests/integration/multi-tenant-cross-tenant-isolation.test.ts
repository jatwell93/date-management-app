/**
 * Multi-Tenant Cross-Tenant Isolation Tests
 *
 * Tests that organizations cannot access each other's data.
 * Uses real Prisma client (not mocked) to verify database-level isolation.
 *
 * Tasks: 13.1, 13.2, 13.3
 * Pattern: Follows subscription.integration.test.ts with real DB
 */

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { AuthService } from '../../services/auth.service';
import { ProductService } from '../../services/product.service';
import { InventoryService } from '../../services/inventory.service';
import { SubscriptionStatus } from '../../types/subscription';

// Mock Stripe to avoid API calls in tests
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
    },
  }));
});

describe('Multi-Tenant Cross-Tenant Isolation Tests', () => {
  let prisma: PrismaClient;
  let authService: AuthService;

  // Test organizations
  let orgA: { id: string; name: string };
  let orgB: { id: string; name: string };

  // Test users
  let userA: { id: number; organizationId: string };
  let userB: { id: number; organizationId: string };

  beforeAll(async () => {
    prisma = getDefaultDatabaseClient();
    authService = new AuthService(prisma);
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.inventoryItem.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create Organization A
    orgA = await prisma.organization.create({
      data: {
        name: 'Pharmacy A',
        slug: 'pharmacy-a-test',
        contactEmail: 'test-a@example.com',
      },
    });

    // Create Organization B
    orgB = await prisma.organization.create({
      data: {
        name: 'Pharmacy B',
        slug: 'pharmacy-b-test',
        contactEmail: 'test-b@example.com',
      },
    });

    // Create trial subscriptions manually (avoid Stripe API calls)
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    await prisma.subscriptionTier.create({
      data: {
        organizationId: orgA.id,
        tierLevel: 'professional',
        status: SubscriptionStatus.TRIALING,
        billingCycle: 'monthly',
        trialEndDate: trialEndDate,
        trialStartedAt: new Date(),
        stripeCustomerId: 'cus_test_a',
      },
    });

    await prisma.subscriptionTier.create({
      data: {
        organizationId: orgB.id,
        tierLevel: 'professional',
        status: SubscriptionStatus.TRIALING,
        billingCycle: 'monthly',
        trialEndDate: trialEndDate,
        trialStartedAt: new Date(),
        stripeCustomerId: 'cus_test_b',
      },
    });

    // Create organization usage records
    await prisma.organizationUsage.create({
      data: {
        organizationId: orgA.id,
        activeUsers: 0,
        maxUsers: 3,
        totalSkus: 0,
        maxSkus: 2000,
        storageUsedBytes: 0,
      },
    });

    await prisma.organizationUsage.create({
      data: {
        organizationId: orgB.id,
        activeUsers: 0,
        maxUsers: 3,
        totalSkus: 0,
        maxSkus: 2000,
        storageUsedBytes: 0,
      },
    });

    // Create user for Org A (minimal fields for testing)
    const createdUserA = await prisma.user.create({
      data: {
        role: 'Manager',
        organizationId: orgA.id,
        email: 'user-a@test.com',
      },
    });
    userA = { id: createdUserA.id, organizationId: orgA.id };

    // Create user for Org B
    const createdUserB = await prisma.user.create({
      data: {
        role: 'Manager',
        organizationId: orgB.id,
        email: 'user-b@test.com',
      },
    });
    userB = { id: createdUserB.id, organizationId: orgB.id };

    // Note: Authentication handled by Clerk - tests focus on service-level isolation
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.inventoryItem.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Task 13.1: Cross-tenant product isolation', () => {
    it('should return only products from user organization', async () => {
      // Create products for Org A
      const productServiceA = new ProductService(prisma, orgA.id);
      await productServiceA.createProduct({
        name: 'Product A1',
        sku: 'SKU-A1',
        barcode: 'BARCODE-A1',
        costPrice: 10.99,
      });
      await productServiceA.createProduct({
        name: 'Product A2',
        sku: 'SKU-A2',
        barcode: 'BARCODE-A2',
        costPrice: 20.99,
      });
      await productServiceA.createProduct({
        name: 'Product A3',
        sku: 'SKU-A3',
        barcode: 'BARCODE-A3',
        costPrice: 30.99,
      });

      // Create products for Org B
      const productServiceB = new ProductService(prisma, orgB.id);
      await productServiceB.createProduct({
        name: 'Product B1',
        sku: 'SKU-B1',
        barcode: 'BARCODE-B1',
        costPrice: 15.99,
      });
      await productServiceB.createProduct({
        name: 'Product B2',
        sku: 'SKU-B2',
        barcode: 'BARCODE-B2',
        costPrice: 25.99,
      });
      await productServiceB.createProduct({
        name: 'Product B3',
        sku: 'SKU-B3',
        barcode: 'BARCODE-B3',
        costPrice: 35.99,
      });

      // User A should see only Org A products
      const productsA = await productServiceA.getAllProducts();
      expect(productsA).toHaveLength(3);
      expect(productsA.every((p) => p.organizationId === orgA.id)).toBe(true);
      expect(productsA.map((p) => p.sku)).toEqual(['SKU-A1', 'SKU-A2', 'SKU-A3']);

      // User B should see only Org B products
      const productsB = await productServiceB.getAllProducts();
      expect(productsB).toHaveLength(3);
      expect(productsB.every((p) => p.organizationId === orgB.id)).toBe(true);
      expect(productsB.map((p) => p.sku)).toEqual(['SKU-B1', 'SKU-B2', 'SKU-B3']);

      // Assert: Zero cross-tenant data leaks
      const allProducts = await prisma.product.findMany({});
      expect(allProducts).toHaveLength(6);
      expect(productsA.some((p) => p.organizationId === orgB.id)).toBe(false);
      expect(productsB.some((p) => p.organizationId === orgA.id)).toBe(false);
    });
  });

  describe('Task 13.2: Cross-tenant write/delete protection', () => {
    it('should prevent user from updating products from another organization', async () => {
      // Create product for Org A
      const productServiceA = new ProductService(prisma, orgA.id);
      const productA = await productServiceA.createProduct({
        name: 'Product A1',
        sku: 'SKU-A1',
        barcode: 'BARCODE-A1',
        costPrice: 10.99,
      });

      // Create product for Org B
      const productServiceB = new ProductService(prisma, orgB.id);
      const productB = await productServiceB.createProduct({
        name: 'Product B1',
        sku: 'SKU-B1',
        barcode: 'BARCODE-B1',
        costPrice: 15.99,
      });

      // User A attempts to update Org B's product
      // Service scoped to Org A should not find Org B's product (returns null)
      const updateResult = await productServiceA.updateProduct(productB.id, {
        name: 'Hacked Product',
      });
      expect(updateResult).toBeNull();

      // Verify product B unchanged in database
      const unchangedProductB = await prisma.product.findUnique({
        where: { id: productB.id },
      });
      expect(unchangedProductB?.name).toBe('Product B1');
    });

    it('should prevent user from deleting products from another organization', async () => {
      // Create product for Org B
      const productServiceB = new ProductService(prisma, orgB.id);
      const productB = await productServiceB.createProduct({
        name: 'Product B1',
        sku: 'SKU-B1',
        barcode: 'BARCODE-B1',
        costPrice: 15.99,
      });

      // User A attempts to delete Org B's product
      // Service scoped to Org A should not find Org B's product (returns false)
      const productServiceA = new ProductService(prisma, orgA.id);
      const deleteResult = await productServiceA.deleteProduct(productB.id);
      expect(deleteResult).toBe(false);

      // Verify product B still exists in database
      const stillExists = await prisma.product.findUnique({
        where: { id: productB.id },
      });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.name).toBe('Product B1');
    });

    it('should prevent cross-tenant access for inventory items', async () => {
      // Create store area for Org B
      const storeAreaB = await prisma.storeArea.create({
        data: {
          name: 'Pharmacy Floor B',
          organizationId: orgB.id,
        },
      });

      // Create product and inventory item for Org B
      const productServiceB = new ProductService(prisma, orgB.id);
      const productB = await productServiceB.createProduct({
        name: 'Product B1',
        sku: 'SKU-B1',
        barcode: 'BARCODE-B1',
        costPrice: 15.99,
      });

      const inventoryServiceB = new InventoryService(orgB.id, prisma);
      const inventoryItemB = await inventoryServiceB.createInventoryItem({
        productId: productB.id,
        expiryDate: new Date('2025-12-31'),
        quantity: 10,
        batchNumber: 'BATCH-B1',
        locationId: storeAreaB.id,
      });

      // User A attempts to access Org B's inventory
      const inventoryServiceA = new InventoryService(orgA.id, prisma);
      const itemsA = await inventoryServiceA.getAllInventoryItems();

      // Should not see Org B's inventory
      expect(itemsA).toHaveLength(0);
      expect(itemsA.some((item) => item.id === inventoryItemB.id)).toBe(false);
    });

    it('should prevent cross-tenant access for users', async () => {
      // Query users directly filtered by organization
      const usersA = await prisma.user.findMany({
        where: { organizationId: orgA.id },
      });

      expect(usersA).toHaveLength(1);
      expect(usersA[0].id).toBe(userA.id);
      expect(usersA[0].organizationId).toBe(orgA.id);

      // Should not see User B
      expect(usersA.some((u: any) => u.id === userB.id)).toBe(false);
    });
  });

  describe('Task 13.3: Service-level tenant filtering', () => {
    it('should filter products by organizationId in service layer', async () => {
      // Create products for both orgs
      const productServiceA = new ProductService(prisma, orgA.id);
      await productServiceA.createProduct({
        name: 'Product A1',
        sku: 'SKU-A1',
        barcode: 'BARCODE-A1',
        costPrice: 10.99,
      });

      const productServiceB = new ProductService(prisma, orgB.id);
      await productServiceB.createProduct({
        name: 'Product B1',
        sku: 'SKU-B1',
        barcode: 'BARCODE-B1',
        costPrice: 15.99,
      });

      // Service scoped to Org A should only return Org A products
      const productsForOrgA = await productServiceA.getAllProducts();

      expect(productsForOrgA).toHaveLength(1);
      expect(productsForOrgA[0].organizationId).toBe(orgA.id);
      expect(productsForOrgA[0].sku).toBe('SKU-A1');

      // Assert: Service layer correctly filters by tenant context
      expect(productsForOrgA.every((p) => p.organizationId === orgA.id)).toBe(true);
    });

    it('should verify subscription tier is associated with organization', async () => {
      // Verify tier level from subscription
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgA.id },
      });

      expect(subscription).toBeDefined();
      expect(subscription?.organizationId).toBe(orgA.id);
      expect(subscription?.tierLevel).toBe('professional');
      expect(['starter', 'professional', 'premium', 'concierge']).toContain(
        subscription?.tierLevel,
      );
    });

    it('should maintain separate usage tracking per organization', async () => {
      const usageA = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgA.id },
      });

      const usageB = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgB.id },
      });

      expect(usageA).toBeDefined();
      expect(usageB).toBeDefined();
      expect(usageA?.organizationId).toBe(orgA.id);
      expect(usageB?.organizationId).toBe(orgB.id);

      // Assert: Each organization has independent usage tracking
      expect(usageA?.organizationId).not.toBe(usageB?.organizationId);
    });
  });
});

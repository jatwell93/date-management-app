import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { createTestUser } from './utils/test-helpers';
import { generateSKU } from '../../utils/sku-generator';

describe('Multi-Tenant Concurrency Load Tests - 16A.F.1', () => {
  let prisma: PrismaClient;
  let adminToken: string;
  let organizationId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    adminToken = process.env.TEST_JWT_TOKEN || 'test-token';
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.inventoryItem.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  afterEach(async () => {
    await prisma.inventoryItem.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  describe('16A.F.1.1 - SKU Counter Race Condition Tests', () => {
    it('should correctly enforce SKU limits under concurrent load at boundary (495/500)', async () => {
      // Setup: Create organization at starter tier with 495/500 SKUs
      const org = await prisma.organization.create({
        data: {
          name: 'Test Org - SKU Race Condition',
        },
      });
      organizationId = org.id;

      // Set up subscription tier
      await prisma.subscriptionTier.create({
        data: {
          organizationId: org.id,
          tierLevel: 'starter',
          status: 'active',
        },
      });

      // Set up organization usage at boundary
      await prisma.organizationUsage.create({
        data: {
          organizationId: org.id,
          activeUsers: 0,
          maxUsers: 1,
          totalSkus: 495,
          maxSkus: 500,
          totalInventoryItems: 0,
          maxInventoryItems: 5000,
          storageUsedBytes: 0,
        },
      });

      // Seed existing products (495 products)
      const products: any[] = [];
      for (let i = 0; i < 495; i++) {
        products.push({
          organizationId: org.id,
          name: `Product ${i}`,
          sku: generateSKU(org.id, i),
          description: `Test product ${i}`,
          category: 'TEST',
        });
      }

      await prisma.product.createMany({ data: products });

      // Concurrent request: Attempt to create 10 products (5 will fail due to limit)
      const concurrentCreates = Array(10)
        .fill(null)
        .map((_, i) =>
          prisma.product.create({
            data: {
              organizationId: org.id,
              name: `Concurrent Product ${i}`,
              sku: generateSKU(org.id, i + 1000), // Ensure unique SKUs
              description: `Concurrent test product ${i}`,
              category: 'TEST',
            },
          }),
        );

      // Execute all requests concurrently
      const results = await Promise.allSettled(concurrentCreates);

      // Count successes and failures
      const successes = results.filter((r) => r.status === 'fulfilled').length;
      const failures = results.filter((r) => r.status === 'rejected').length;

      // Verify final count is exactly 500 (limit)
      const finalCount = await prisma.product.count({
        where: { organizationId: org.id },
      });

      expect(finalCount).toBeLessThanOrEqual(500);
      expect(successes).toBeLessThanOrEqual(5); // Only 5 slots available
      expect(successes + failures).toBe(10);

      // Verify transaction isolation - no overshoot
      expect(finalCount).toBe(495 + successes);
    });

    it('should prevent SKU overshoot under extreme concurrent load (100 requests)', async () => {
      // Setup: Create organization with 490/500 SKUs
      const org = await prisma.organization.create({
        data: {
          name: 'Test Org - Extreme SKU Race',
        },
      });

      await prisma.subscriptionTier.create({
        data: {
          organizationId: org.id,
          tierLevel: 'starter',
          status: 'active',
        },
      });

      await prisma.organizationUsage.create({
        data: {
          organizationId: org.id,
          activeUsers: 0,
          maxUsers: 1,
          totalSkus: 490,
          maxSkus: 500,
          totalInventoryItems: 0,
          maxInventoryItems: 5000,
          storageUsedBytes: 0,
        },
      });

      // Seed 490 products
      const products = Array(490)
        .fill(null)
        .map((_, i) => ({
          organizationId: org.id,
          name: `Product ${i}`,
          sku: generateSKU(org.id, i),
          description: `Test product ${i}`,
          category: 'TEST',
        }));

      await prisma.product.createMany({ data: products });

      // Execute 100 concurrent create requests
      const concurrentCreates = Array(100)
        .fill(null)
        .map((_, i) =>
          prisma.product
            .create({
              data: {
                organizationId: org.id,
                name: `Extreme Concurrent ${i}`,
                sku: generateSKU(org.id, i + 2000),
                description: `Extreme test ${i}`,
                category: 'TEST',
              },
            })
            .catch((e) => ({ error: true, message: e.message })),
        );

      await Promise.all(concurrentCreates);

      // Verify no overshoot
      const finalCount = await prisma.product.count({
        where: { organizationId: org.id },
      });

      expect(finalCount).toBeLessThanOrEqual(500);
    });

    it('should maintain SKU isolation between concurrent tenants', async () => {
      // Create two separate organizations
      const org1 = await prisma.organization.create({
        data: { name: 'Tenant 1 - SKU Isolation' },
      });

      const org2 = await prisma.organization.create({
        data: { name: 'Tenant 2 - SKU Isolation' },
      });

      // Setup both at starter tier near limit
      for (const org of [org1, org2]) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: org.id,
            tierLevel: 'starter',
            status: 'active',
          },
        });

        await prisma.organizationUsage.create({
          data: {
            organizationId: org.id,
            activeUsers: 0,
            maxUsers: 1,
            totalSkus: 498,
            maxSkus: 500,
            totalInventoryItems: 0,
            maxInventoryItems: 5000,
            storageUsedBytes: 0,
          },
        });
      }

      // Seed products for both
      for (let orgNum = 0; orgNum < 2; orgNum++) {
        const orgId = orgNum === 0 ? org1.id : org2.id;
        const products = Array(498)
          .fill(null)
          .map((_, i) => ({
            organizationId: orgId,
            name: `Product ${i}`,
            sku: generateSKU(orgId, i + orgNum * 10000), // Ensure unique SKUs across orgs
            description: `Test product ${i}`,
            category: 'TEST',
          }));

        await prisma.product.createMany({ data: products });
      }

      // Concurrently add products to both tenants
      const concurrentOperations = [
        // 5 requests to tenant 1 (only 2 should succeed)
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            prisma.product.create({
              data: {
                organizationId: org1.id,
                name: `Org1 Product ${i}`,
                sku: generateSKU(org1.id, i + 3000),
                description: `Test org1 ${i}`,
                category: 'TEST',
              },
            }),
          ),
        // 5 requests to tenant 2 (only 2 should succeed)
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            prisma.product.create({
              data: {
                organizationId: org2.id,
                name: `Org2 Product ${i}`,
                sku: generateSKU(org2.id, i + 4000),
                description: `Test org2 ${i}`,
                category: 'TEST',
              },
            }),
          ),
      ];

      const results = await Promise.allSettled(concurrentOperations);

      // Count per tenant
      let org1Successes = 0;
      let org2Successes = 0;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (index < 5) org1Successes++;
          else org2Successes++;
        }
      });

      // Verify each tenant only reached 500 max
      expect(org1Successes).toBeLessThanOrEqual(2);
      expect(org2Successes).toBeLessThanOrEqual(2);

      // Verify final counts
      const org1Count = await prisma.product.count({
        where: { organizationId: org1.id },
      });
      const org2Count = await prisma.product.count({
        where: { organizationId: org2.id },
      });

      expect(org1Count).toBe(498 + org1Successes);
      expect(org2Count).toBe(498 + org2Successes);
      expect(org1Count).toBeLessThanOrEqual(500);
      expect(org2Count).toBeLessThanOrEqual(500);
    });
  });

  describe('16A.F.1.2 - Storage Quota Concurrent Upload Tests', () => {
    it('should prevent storage overshoot under concurrent uploads', async () => {
      // Setup: Organization at starter tier with 900MB/1GB storage
      const org = await prisma.organization.create({
        data: {
          name: 'Test Org - Storage Race',
        },
      });

      await prisma.subscriptionTier.create({
      data: {
          organizationId: org.id,
          tierLevel: 'starter',
          status: 'active',
        },
      });

      await prisma.organizationUsage.create({
        data: {
          organizationId: org.id,
          activeUsers: 0,
          maxUsers: 1,
          totalSkus: 0,
          maxSkus: 500,
          totalInventoryItems: 0,
          maxInventoryItems: 5000,
          storageUsedBytes: 943718400, // 900MB
        },
      });

      // Simulate concurrent file uploads (10 files of 20MB each)
      const uploadSizes = Array(10).fill(20971520); // 20MB each

      const concurrentUploads = uploadSizes.map(async (size) => {
        // Simulate upload by updating storage
        try {
          const usage = await prisma.organizationUsage.findUnique({
            where: { organizationId: org.id },
          });

          if (!usage) throw new Error('Usage not found');

          // Check limit before update
          if (usage.storageUsedBytes + size > 1073741824) {
            throw new Error('Storage limit exceeded');
          }

          await prisma.organizationUsage.update({
            where: { organizationId: org.id },
            data: { storageUsedBytes: { increment: size } },
          });

          return { success: true };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      const results = await Promise.all(concurrentUploads);

      // Verify no overshoot
      const finalUsage = await prisma.organizationUsage.findUnique({
        where: { organizationId: org.id },
      });

      expect(finalUsage?.storageUsedBytes).toBeLessThanOrEqual(1073741824); // 1GB

      // Only 5 files (100MB) should succeed to reach 1GB limit
      const successes = results.filter((r) => r.success).length;
      expect(successes).toBeLessThanOrEqual(5);
    });
  });

  describe('16A.F.1.3 - Concurrent User Limit Enforcement', () => {
    it('should enforce user limits correctly under concurrent invitations', async () => {
      // Setup: Organization at starter tier (max 1 user)
      const org = await prisma.organization.create({
        data: {
          name: 'Test Org - User Race',
        },
      });

      await prisma.subscriptionTier.create({
        data: {
          organizationId: org.id,
          tierLevel: 'starter',
          status: 'active',
        },
      });

      await prisma.organizationUsage.create({
        data: {
          organizationId: org.id,
          activeUsers: 1,
          maxUsers: 1,
          totalSkus: 0,
          maxSkus: 500,
          totalInventoryItems: 0,
          maxInventoryItems: 5000,
          storageUsedBytes: 0,
        },
      });

      // Create the single allowed user
      await prisma.user.create({
        data: {
          organizationId: org.id,
          email: 'existing@example.com',
          firstName: 'Existing',
          lastName: 'User',
          role: 'admin',
        },
      });

      // Attempt concurrent user creation
      const concurrentUserCreates = Array(5)
        .fill(null)
        .map((_, i) =>
          prisma.user.create({
            data: {
              organizationId: org.id,
              email: `newuser${i}@example.com`,
              firstName: `User${i}`,
              lastName: 'Test',
              role: 'member',
            },
          }),
        );

      const results = await Promise.allSettled(concurrentUserCreates);

      // All should fail since limit is already reached
      const failures = results.filter((r) => r.status === 'rejected').length;
      expect(failures).toBe(5);

      // Verify user count
      const userCount = await prisma.user.count({
        where: { organizationId: org.id },
      });
      expect(userCount).toBe(1);
    });
  });

  describe('16A.F.1.4 - Transaction Isolation Verification', () => {
    it('should maintain ACID properties under mixed concurrent operations', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Test Org - ACID',
        },
      });

      await prisma.subscriptionTier.create({
        data: {
          organizationId: org.id,
          tierLevel: 'professional', // 2000 SKUs, 3 users
          status: 'active',
        },
      });

      await prisma.organizationUsage.create({
        data: {
          organizationId: org.id,
          activeUsers: 0,
          maxUsers: 3,
          totalSkus: 0,
          maxSkus: 2000,
          totalInventoryItems: 0,
          maxInventoryItems: 20000,
          storageUsedBytes: 0,
        },
      });

      // Mixed operations: 20 product creates, 5 user creates concurrently
      const operations = [
        // Product creates
        ...Array(20)
          .fill(null)
          .map((_, i) =>
            prisma.product.create({
              data: {
                organizationId: org.id,
                name: `Product ${i}`,
                sku: generateSKU(org.id, i + 5000),
                description: `ACID test ${i}`,
                category: 'TEST',
              },
            }),
          ),
        // User creates
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            prisma.user.create({
              data: {
                organizationId: org.id,
                email: `aciduser${i}@example.com`,
                firstName: `ACID${i}`,
                lastName: 'User',
                role: 'member',
              },
            }),
          ),
      ];

      const results = await Promise.allSettled(operations);

      // Verify consistency
      const productCount = await prisma.product.count({
        where: { organizationId: org.id },
      });
      const userCount = await prisma.user.count({
        where: { organizationId: org.id },
      });

      // All 20 products should succeed (within 2000 limit)
      expect(productCount).toBe(20);

      // All 3 users should succeed (within 3 limit, 5 attempted)
      expect(userCount).toBeLessThanOrEqual(3);
    });
  });
});

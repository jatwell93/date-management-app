/**
 * Multi-Tenant Load Tests
 *
 * Tests system behavior under concurrent load from multiple organizations.
 * Verifies usage counters remain accurate and tenant isolation holds under stress.
 *
 * Task: 13.12
 * Pattern: Reuse upload-load.test.ts pattern for concurrent operations
 *
 * Note: These tests are opt-in via RUN_MULTI_TENANT_LOAD_TESTS=true
 */

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { ProductService } from '../../services/product.service';
import { SubscriptionStatus } from '../../types/subscription';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test_load' }),
    },
  }));
});

// Skip load tests unless explicitly enabled
const describeLoadTests =
  process.env.RUN_MULTI_TENANT_LOAD_TESTS === 'true' ? describe : describe.skip;

describeLoadTests('Multi-Tenant Load Tests', () => {
  let prisma: PrismaClient;

  // Test organizations
  let org1: { id: string; name: string };
  let org2: { id: string; name: string };
  let org3: { id: string; name: string };

  beforeAll(async () => {
    prisma = getDefaultDatabaseClient();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create three test organizations
    org1 = await prisma.organization.create({
      data: {
        name: 'Load Test Org 1',
        slug: 'load-test-org-1',
        contactEmail: 'org1@loadtest.com',
      },
    });

    org2 = await prisma.organization.create({
      data: {
        name: 'Load Test Org 2',
        slug: 'load-test-org-2',
        contactEmail: 'org2@loadtest.com',
      },
    });

    org3 = await prisma.organization.create({
      data: {
        name: 'Load Test Org 3',
        slug: 'load-test-org-3',
        contactEmail: 'org3@loadtest.com',
      },
    });

    // Create subscriptions for all orgs
    await prisma.subscriptionTier.createMany({
      data: [
        {
          organizationId: org1.id,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_load_org1',
        },
        {
          organizationId: org2.id,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_load_org2',
        },
        {
          organizationId: org3.id,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_load_org3',
        },
      ],
    });

    // Create usage tracking records
    await prisma.organizationUsage.createMany({
      data: [
        {
          organizationId: org1.id,
          activeUsers: 1,
          maxUsers: 5,
          totalSkus: 0,
          maxSkus: 2000,
          storageUsedBytes: 0,
        },
        {
          organizationId: org2.id,
          activeUsers: 1,
          maxUsers: 5,
          totalSkus: 0,
          maxSkus: 2000,
          storageUsedBytes: 0,
        },
        {
          organizationId: org3.id,
          activeUsers: 1,
          maxUsers: 5,
          totalSkus: 0,
          maxSkus: 2000,
          storageUsedBytes: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Task 13.12: Load tests for concurrent organizations', () => {
    it('should handle concurrent product creation from multiple organizations', async () => {
      const productsPerOrg = 10;

      // Create products concurrently from all 3 orgs
      const promises: Promise<{ id: string; name: string; sku: string; barcode: string; costPrice: number }>[] = [];

      for (let i = 0; i < productsPerOrg; i++) {
        const productService1 = new ProductService(prisma, org1.id);
        promises.push(
          productService1.createProduct({
            name: `Org1 Product ${i}`,
            sku: `ORG1-SKU-${i}`,
            barcode: `ORG1-BARCODE-${i}`,
            costPrice: 10.0 + i,
          }),
        );

        const productService2 = new ProductService(prisma, org2.id);
        promises.push(
          productService2.createProduct({
            name: `Org2 Product ${i}`,
            sku: `ORG2-SKU-${i}`,
            barcode: `ORG2-BARCODE-${i}`,
            costPrice: 20.0 + i,
          }),
        );

        const productService3 = new ProductService(prisma, org3.id);
        promises.push(
          productService3.createProduct({
            name: `Org3 Product ${i}`,
            sku: `ORG3-SKU-${i}`,
            barcode: `ORG3-BARCODE-${i}`,
            costPrice: 30.0 + i,
          }),
        );
      }

      // Wait for all operations to complete
      const results = await Promise.all(promises);

      // Verify all products were created
      expect(results).toHaveLength(productsPerOrg * 3);
      expect(results.every((r) => r !== null)).toBe(true);

      // Verify each org has exactly the right number of products
      const productService1 = new ProductService(prisma, org1.id);
      const products1 = await productService1.getAllProducts();
      expect(products1).toHaveLength(productsPerOrg);

      const productService2 = new ProductService(prisma, org2.id);
      const products2 = await productService2.getAllProducts();
      expect(products2).toHaveLength(productsPerOrg);

      const productService3 = new ProductService(prisma, org3.id);
      const products3 = await productService3.getAllProducts();
      expect(products3).toHaveLength(productsPerOrg);

      // Verify usage counters are accurate
      const usage1 = await prisma.organizationUsage.findUnique({
        where: { organizationId: org1.id },
      });
      expect(usage1?.totalSkus).toBe(productsPerOrg);

      const usage2 = await prisma.organizationUsage.findUnique({
        where: { organizationId: org2.id },
      });
      expect(usage2?.totalSkus).toBe(productsPerOrg);

      const usage3 = await prisma.organizationUsage.findUnique({
        where: { organizationId: org3.id },
      });
      expect(usage3?.totalSkus).toBe(productsPerOrg);
    }, 30000); // 30 second timeout for load test

    it('should maintain tenant isolation under concurrent load', async () => {
      const productsPerOrg = 20;

      // Create products concurrently
      const promises: Promise<{ id: string; name: string; sku: string; barcode: string; costPrice: number }>[] = [];

      for (let i = 0; i < productsPerOrg; i++) {
        const productService1 = new ProductService(prisma, org1.id);
        promises.push(
          productService1.createProduct({
            name: `Isolation Test Org1 ${i}`,
            sku: `ISO-ORG1-${i}`,
            barcode: `ISO-ORG1-BAR-${i}`,
            costPrice: 15.0,
          }),
        );

        const productService2 = new ProductService(prisma, org2.id);
        promises.push(
          productService2.createProduct({
            name: `Isolation Test Org2 ${i}`,
            sku: `ISO-ORG2-${i}`,
            barcode: `ISO-ORG2-BAR-${i}`,
            costPrice: 25.0,
          }),
        );
      }

      await Promise.all(promises);

      // Verify no cross-contamination
      const productService1 = new ProductService(prisma, org1.id);
      const products1 = await productService1.getAllProducts();

      expect(products1).toHaveLength(productsPerOrg);
      expect(products1.every((p) => p.organizationId === org1.id)).toBe(true);
      expect(products1.every((p) => p.sku.startsWith('ISO-ORG1-'))).toBe(true);

      const productService2 = new ProductService(prisma, org2.id);
      const products2 = await productService2.getAllProducts();

      expect(products2).toHaveLength(productsPerOrg);
      expect(products2.every((p) => p.organizationId === org2.id)).toBe(true);
      expect(products2.every((p) => p.sku.startsWith('ISO-ORG2-'))).toBe(true);
    }, 30000);

    it('should handle high concurrency without data corruption', async () => {
      const concurrentOps = 50;

      // Create many products concurrently from single org
      const productService = new ProductService(prisma, org1.id);
      const promises: Promise<{ id: string; name: string; sku: string; barcode: string; costPrice: number }>[] = [];

      for (let i = 0; i < concurrentOps; i++) {
        promises.push(
          productService.createProduct({
            name: `Concurrent Product ${i}`,
            sku: `CONCURRENT-SKU-${i}`,
            barcode: `CONCURRENT-BAR-${i}`,
            costPrice: 10.0,
          }),
        );
      }

      const results = await Promise.all(promises);

      // Verify all products created successfully
      expect(results).toHaveLength(concurrentOps);
      expect(results.every((r) => r !== null)).toBe(true);

      // Verify no duplicate SKUs
      const skus = results.map((r) => r.sku);
      const uniqueSkus = new Set(skus);
      expect(uniqueSkus.size).toBe(concurrentOps);

      // Verify usage counter is accurate
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: org1.id },
      });
      expect(usage?.totalSkus).toBe(concurrentOps);

      // Verify database has exact count
      const dbCount = await prisma.product.count({
        where: { organizationId: org1.id },
      });
      expect(dbCount).toBe(concurrentOps);
    }, 30000);

    it('should handle mixed read/write operations under load', async () => {
      // Pre-create some products
      const productService = new ProductService(prisma, org1.id);
      for (let i = 0; i < 10; i++) {
        await productService.createProduct({
          name: `Initial Product ${i}`,
          sku: `INIT-SKU-${i}`,
          barcode: `INIT-BAR-${i}`,
          costPrice: 10.0,
        });
      }

      // Mix of concurrent reads and writes
      const promises: (Promise<{ id: string; name: string; sku: string; barcode: string; costPrice: number }[]> | Promise<{ id: string; name: string; sku: string; barcode: string; costPrice: number }>)[] = [];

      // 20 reads
      for (let i = 0; i < 20; i++) {
        promises.push(productService.getAllProducts());
      }

      // 10 writes
      for (let i = 0; i < 10; i++) {
        promises.push(
          productService.createProduct({
            name: `New Product ${i}`,
            sku: `NEW-SKU-${i}`,
            barcode: `NEW-BAR-${i}`,
            costPrice: 20.0,
          }),
        );
      }

      const results = await Promise.all(promises);

      // Verify reads returned arrays
      const reads = results.filter((r) => Array.isArray(r));
      expect(reads.length).toBe(20);

      // Verify writes returned products
      const writes = results.filter((r) => r && !Array.isArray(r) && r.sku);
      expect(writes.length).toBe(10);

      // Verify final count
      const finalProducts = await productService.getAllProducts();
      expect(finalProducts).toHaveLength(20); // 10 initial + 10 new

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: org1.id },
      });
      expect(usage?.totalSkus).toBe(20);
    }, 30000);

    it('should maintain performance with multiple organizations under load', async () => {
      const startTime = Date.now();
      const productsPerOrg = 15;

      // Concurrent operations across all 3 orgs
      const promises: Promise<{ id: string; name: string; sku: string; barcode: string; costPrice: number }>[] = [];

      for (let i = 0; i < productsPerOrg; i++) {
        // Org 1
        const service1 = new ProductService(prisma, org1.id);
        promises.push(
          service1.createProduct({
            name: `Perf Org1 ${i}`,
            sku: `PERF-ORG1-${i}`,
            barcode: `PERF-ORG1-BAR-${i}`,
            costPrice: 10.0,
          }),
        );

        // Org 2
        const service2 = new ProductService(prisma, org2.id);
        promises.push(
          service2.createProduct({
            name: `Perf Org2 ${i}`,
            sku: `PERF-ORG2-${i}`,
            barcode: `PERF-ORG2-BAR-${i}`,
            costPrice: 20.0,
          }),
        );

        // Org 3
        const service3 = new ProductService(prisma, org3.id);
        promises.push(
          service3.createProduct({
            name: `Perf Org3 ${i}`,
            sku: `PERF-ORG3-${i}`,
            barcode: `PERF-ORG3-BAR-${i}`,
            costPrice: 30.0,
          }),
        );
      }

      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all products created
      const totalProducts = productsPerOrg * 3;
      const dbCount = await prisma.product.count();
      expect(dbCount).toBe(totalProducts);

      // Performance assertion: should complete in reasonable time
      // 45 products should complete in under 25 seconds
      expect(duration).toBeLessThan(25000);

      console.log(`Created ${totalProducts} products across 3 orgs in ${duration}ms`);
    }, 30000);
  });
});

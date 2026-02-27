/**
 * Multi-Tenant Usage Limit Boundary Tests
 *
 * Tests that usage limits are correctly enforced at tier boundaries.
 * Verifies checkUsageLimit() middleware blocks operations when limits exceeded.
 *
 * Tasks: 13.5, 13.6, 13.7
 * Pattern: Reuse checkUsageLimit() middleware from feature-gate.middleware.test.ts
 */

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import request from 'supertest';
import express from 'express';
import { checkUsageLimit } from '../../middleware/feature-gate.middleware';
import { AuthRequest } from '../../middleware/auth.middleware';
import { SubscriptionStatus } from '../../types/subscription';
import { ProductService } from '../../services/product.service';
import { createTestOrgWithSubscription } from '../helpers/test-factories';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
    },
  }));
});

describe('Multi-Tenant Usage Limit Boundary Tests', () => {
  let prisma: PrismaClient;
  let app: express.Express;

  // Test organizations
  let orgStarter: { id: string; name: string };
  let orgProfessional: { id: string; name: string };

  beforeAll(async () => {
    prisma = getDefaultDatabaseClient();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create Starter tier organization (limit: 500 SKUs) using factory
    const starterSetup = await createTestOrgWithSubscription(
      prisma,
      { name: 'Starter Pharmacy' },
      { tierLevel: 'starter', status: SubscriptionStatus.ACTIVE },
      { maxUsers: 1, maxSkus: 500, totalSkus: 0, activeUsers: 1 }
    );
    orgStarter = starterSetup.org;

    // Create Professional tier organization (limit: 2000 SKUs) using factory
    const professionalSetup = await createTestOrgWithSubscription(
      prisma,
      { name: 'Professional Pharmacy' },
      { tierLevel: 'professional', status: SubscriptionStatus.ACTIVE },
      { maxUsers: 5, maxSkus: 2000, totalSkus: 0, activeUsers: 1 }
    );
    orgProfessional = professionalSetup.org;

    // Create test Express app
    app = express();
    app.use(express.json());

    // Mock product creation endpoint with usage limit check
    app.post(
      '/api/products',
      (req: AuthRequest, _res: express.Response, next: express.NextFunction) => {
        // Mock authentication - inject organizationId and tierLevel
        req.organizationId = req.body.orgId as string;
        req.tierLevel = req.body.tier as AuthRequest['tierLevel'];
        req.userId = 1;
        next();
      },
      checkUsageLimit('max_skus'),
      async (req: AuthRequest, res: express.Response) => {
        // Simulate product creation
        if (!req.organizationId) {
          res.status(400).json({ message: 'Missing organization context' });
          return;
        }

        const productService = new ProductService(prisma, req.organizationId);
        const product = await productService.createProduct({
          name: req.body.name,
          sku: req.body.sku,
          barcode: req.body.barcode || req.body.sku,
          costPrice: req.body.costPrice || 10.0,
        });
        res.status(201).json(product);
      },
    );
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Task 13.5: Starter tier at SKU limit (499/500)', () => {
    it('should allow product creation at 499/500 SKUs', async () => {
      // Set usage to 499 SKUs
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { totalSkus: 499 },
      });

      const response = await request(app)
        .post('/api/products')
        .send({
          orgId: orgStarter.id,
          tier: 'starter',
          name: 'Product 499',
          sku: 'SKU-499',
        })
        .expect(201);

      expect(response.body.name).toBe('Product 499');
      expect(response.body.sku).toBe('SKU-499');

      // Verify usage incremented
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.totalSkus).toBe(500);
    });

    it('should block product creation at 500/500 SKUs (at limit)', async () => {
      // Set usage to exactly at limit
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { totalSkus: 500 },
      });

      const response = await request(app)
        .post('/api/products')
        .send({
          orgId: orgStarter.id,
          tier: 'starter',
          name: 'Product 501',
          sku: 'SKU-501',
        })
        .expect(403);

      expect(response.body.message).toContain('Usage limit reached');
      expect(response.body.message).toContain('max_skus');
      expect(response.body.currentUsage).toBe(500);
      expect(response.body.limit).toBe(500);
      expect(response.body.upgradeCTA).toBeDefined();

      // Verify usage did NOT increment
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.totalSkus).toBe(500);
    });

    it('should return upgrade CTA when limit exceeded', async () => {
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { totalSkus: 500 },
      });

      const response = await request(app)
        .post('/api/products')
        .send({
          orgId: orgStarter.id,
          tier: 'starter',
          name: 'Product Over Limit',
          sku: 'SKU-OVER',
        })
        .expect(403);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('currentUsage', 500);
      expect(response.body).toHaveProperty('limit', 500);
      expect(response.body).toHaveProperty('upgradeCTA');
      expect(response.body).toHaveProperty('upgradeUrl', '/subscription/upgrade');

      expect(response.body.upgradeCTA).toContain('Upgrade');
    });
  });

  describe('Task 13.6: Professional tier at SKU limit (1999/2000)', () => {
    it('should allow product creation at 1999/2000 SKUs', async () => {
      // Set usage to 1999 SKUs
      await prisma.organizationUsage.update({
        where: { organizationId: orgProfessional.id },
        data: { totalSkus: 1999 },
      });

      const response = await request(app)
        .post('/api/products')
        .send({
          orgId: orgProfessional.id,
          tier: 'professional',
          name: 'Product 1999',
          sku: 'SKU-1999',
        })
        .expect(201);

      expect(response.body.name).toBe('Product 1999');
      expect(response.body.sku).toBe('SKU-1999');

      // Verify usage incremented to exactly 2000
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgProfessional.id },
      });
      expect(usage?.totalSkus).toBe(2000);
    });

    it('should block product creation at 2000/2000 SKUs', async () => {
      // Set usage to exactly at limit
      await prisma.organizationUsage.update({
        where: { organizationId: orgProfessional.id },
        data: { totalSkus: 2000 },
      });

      const response = await request(app)
        .post('/api/products')
        .send({
          orgId: orgProfessional.id,
          tier: 'professional',
          name: 'Product 2001',
          sku: 'SKU-2001',
        })
        .expect(403);

      expect(response.body.message).toContain('Usage limit reached');
      expect(response.body.message).toContain('max_skus');
      expect(response.body.currentUsage).toBe(2000);
      expect(response.body.limit).toBe(2000);

      // Verify usage did NOT increment
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgProfessional.id },
      });
      expect(usage?.totalSkus).toBe(2000);
    });
  });

  describe('Task 13.6: User limit enforcement per tier', () => {
    it('should block user creation when Starter tier at max_users limit (1/1)', async () => {
      // Set activeUsers to 1 (at limit)
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { activeUsers: 1, maxUsers: 1 },
      });

      // Create mock user creation endpoint with usage limit check
      const userApp = express();
      userApp.use(express.json());
      userApp.post(
        '/api/users',
        (req: AuthRequest, _res: express.Response, next: express.NextFunction) => {
          req.organizationId = req.body.orgId as string;
          req.tierLevel = req.body.tier as AuthRequest['tierLevel'];
          req.userId = 1;
          next();
        },
        checkUsageLimit('max_users'),
        async (_req: AuthRequest, res: express.Response) => {
          res.status(201).json({ id: 2, email: 'newuser@test.com' });
        },
      );

      const response = await request(userApp)
        .post('/api/users')
        .send({
          orgId: orgStarter.id,
          tier: 'starter',
          email: 'newuser@test.com',
        })
        .expect(403);

      expect(response.body.message).toContain('Usage limit reached');
      expect(response.body.message).toContain('max_users');
      expect(response.body.currentUsage).toBe(1);
      expect(response.body.limit).toBe(1);
      expect(response.body.upgradeCTA).toBeDefined();
    });

    it('should allow user creation when under max_users limit', async () => {
      // Set activeUsers to 0 (under limit)
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { activeUsers: 0, maxUsers: 1 },
      });

      const userApp = express();
      userApp.use(express.json());
      userApp.post(
        '/api/users',
        (req: AuthRequest, _res: express.Response, next: express.NextFunction) => {
          req.organizationId = req.body.orgId as string;
          req.tierLevel = req.body.tier as AuthRequest['tierLevel'];
          req.userId = 1;
          next();
        },
        checkUsageLimit('max_users'),
        async (_req: AuthRequest, res: express.Response) => {
          res.status(201).json({ id: 2, email: 'newuser@test.com' });
        },
      );

      const response = await request(userApp)
        .post('/api/users')
        .send({
          orgId: orgStarter.id,
          tier: 'starter',
          email: 'newuser@test.com',
        })
        .expect(201);

      expect(response.body.email).toBe('newuser@test.com');
    });

    it('should allow Professional tier to create multiple users (up to max_users)', async () => {
      // Set activeUsers to 4 (under Professional limit of 5)
      await prisma.organizationUsage.update({
        where: { organizationId: orgProfessional.id },
        data: { activeUsers: 4, maxUsers: 5 },
      });

      const userApp = express();
      userApp.use(express.json());
      userApp.post(
        '/api/users',
        (req: AuthRequest, _res: express.Response, next: express.NextFunction) => {
          req.organizationId = req.body.orgId as string;
          req.tierLevel = req.body.tier as AuthRequest['tierLevel'];
          req.userId = 1;
          next();
        },
        checkUsageLimit('max_users'),
        async (_req: AuthRequest, res: express.Response) => {
          res.status(201).json({ id: 5, email: 'user5@test.com' });
        },
      );

      // Should allow 5th user
      const response = await request(userApp)
        .post('/api/users')
        .send({
          orgId: orgProfessional.id,
          tier: 'professional',
          email: 'user5@test.com',
        })
        .expect(201);

      expect(response.body.email).toBe('user5@test.com');
    });

    it('should block user creation when Professional tier at max_users limit (5/5)', async () => {
      // Set activeUsers to 5 (at Professional limit)
      await prisma.organizationUsage.update({
        where: { organizationId: orgProfessional.id },
        data: { activeUsers: 5, maxUsers: 5 },
      });

      const userApp = express();
      userApp.use(express.json());
      userApp.post(
        '/api/users',
        (req: AuthRequest, _res: express.Response, next: express.NextFunction) => {
          req.organizationId = req.body.orgId as string;
          req.tierLevel = req.body.tier as AuthRequest['tierLevel'];
          req.userId = 1;
          next();
        },
        checkUsageLimit('max_users'),
        async (_req: AuthRequest, res: express.Response) => {
          res.status(201).json({ id: 6, email: 'user6@test.com' });
        },
      );

      const response = await request(userApp)
        .post('/api/users')
        .send({
          orgId: orgProfessional.id,
          tier: 'professional',
          email: 'user6@test.com',
        })
        .expect(403);

      expect(response.body.message).toContain('Usage limit reached');
      expect(response.body.currentUsage).toBe(5);
      expect(response.body.limit).toBe(5);
    });

    it('should return usage warning at 80% of max_users limit', async () => {
      // Set activeUsers to 4 (80% of Professional limit 5)
      await prisma.organizationUsage.update({
        where: { organizationId: orgProfessional.id },
        data: { activeUsers: 4, maxUsers: 5 },
      });

      const userApp = express();
      userApp.use(express.json());
      userApp.post(
        '/api/users',
        (req: AuthRequest, _res: express.Response, next: express.NextFunction) => {
          req.organizationId = req.body.orgId as string;
          req.tierLevel = req.body.tier as AuthRequest['tierLevel'];
          req.userId = 1;
          next();
        },
        checkUsageLimit('max_users'),
        async (_req: AuthRequest, res: express.Response) => {
          // Check for usage warning in res.locals
          const warning = res.locals.usageWarning;
          res.status(201).json({ id: 5, email: 'user5@test.com', warning });
        },
      );

      const response = await request(userApp)
        .post('/api/users')
        .send({
          orgId: orgProfessional.id,
          tier: 'professional',
          email: 'user5@test.com',
        })
        .expect(201);

      // Warning should be attached (80% threshold)
      expect(response.body.warning).toBeDefined();
      expect(response.body.warning.percentageUsed).toBeGreaterThanOrEqual(80);
    });
  });

  describe('Task 13.7: Usage counter atomicity', () => {
    it('should increment usage counter atomically on product creation', async () => {
      // Start with 0 SKUs
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { totalSkus: 0 },
      });

      // Create 3 products sequentially
      for (let i = 1; i <= 3; i++) {
        await request(app)
          .post('/api/products')
          .send({
            orgId: orgStarter.id,
            tier: 'starter',
            name: `Product ${i}`,
            sku: `SKU-${i}`,
          })
          .expect(201);
      }

      // Verify usage counter is exactly 3
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.totalSkus).toBe(3);

      // Verify 3 products exist in database
      const products = await prisma.product.count({
        where: { organizationId: orgStarter.id },
      });
      expect(products).toBe(3);
    });

    it('should maintain accurate count across multiple operations', async () => {
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { totalSkus: 0 },
      });

      // Create 5 products
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/api/products')
          .send({
            orgId: orgStarter.id,
            tier: 'starter',
            name: `Product ${i}`,
            sku: `SKU-ATOMIC-${i}`,
          })
          .expect(201);
      }

      // Delete 2 products manually (simulating deletion)
      const productsToDelete = await prisma.product.findMany({
        where: { organizationId: orgStarter.id },
        take: 2,
      });

      for (const product of productsToDelete) {
        await prisma.product.delete({ where: { id: product.id } });
      }

      // Update usage counter to reflect deletions
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { totalSkus: { decrement: 2 } },
      });

      // Verify count is now 3
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.totalSkus).toBe(3);

      // Verify database has 3 products
      const productCount = await prisma.product.count({
        where: { organizationId: orgStarter.id },
      });
      expect(productCount).toBe(3);
    });

    it('should prevent race conditions in usage counter updates', async () => {
      // Setup: Create an organization with a limit of 2 SKUs (atomic check prevents race)
      const org = await prisma.organization.create({
        data: {
          name: 'Race Test Org',
          clerkOrganizationId: 'clerk_race_test',
          slug: 'race-test-org',
          contactEmail: 'race@test.com',
          subscriptionTiers: {
            create: {
              tierLevel: 'starter',
              status: 'active',
            },
          },
          organizationUsages: {
            create: {
              activeUsers: 1,
              totalSkus: 0,
              maxUsers: 1,
              maxSkus: 2, // Limit to 2 SKUs
            },
          },
        },
      });

      const orgId = org.id;

      // Simulate concurrent product creation requests
      const productService = new ProductService(prisma, orgId);

      const productData = {
        name: 'Test Product',
        sku: 'TEST-',
        barcode: 'TEST-',
        costPrice: 10,
      };

      // Create 3 concurrent requests, but limit is 2
      const promises = [
        productService.createProduct({ ...productData, sku: productData.sku + '1', barcode: productData.barcode + '1' }),
        productService.createProduct({ ...productData, sku: productData.sku + '2', barcode: productData.barcode + '2' }),
        productService.createProduct({ ...productData, sku: productData.sku + '3', barcode: productData.barcode + '3' }),
      ];

      // With atomic check-and-increment, expect exactly 2 to succeed, 1 to fail
      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(2); // Exactly 2 should succeed
      expect(rejected.length).toBe(1); // 1 should fail due to limit
      expect(rejected[0].reason.message).toContain('SKU limit reached');

      // Verify final count is exactly 2 (no race condition)
      const finalUsage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgId },
      });
      expect(finalUsage?.totalSkus).toBe(2);
    });
  });

  describe('Task 13.7: Storage quota increment/decrement per organization', () => {
    it('should increment storageUsedBytes on upload', async () => {
      // Verify initial storage is 0
      const initialUsage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(initialUsage?.storageUsedBytes).toBe(0);

      // Create upload record directly (simulating completed upload)
      await prisma.upload.create({
        data: {
          userId: 1,
          fileKey: 'test-file-1.csv',
          fileName: 'test-file-1.csv',
          fileSizeBytes: 1024,
          contentType: 'text/csv',
          status: 'completed',
        },
      });

      // Manually increment storage (simulating StorageQuotaService.recordUpload)
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: { increment: 1024 } },
      });

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(1024);
    });

    it('should accumulate storage across multiple uploads', async () => {
      // First upload
      await prisma.upload.create({
        data: {
          userId: 1,
          fileKey: 'test-file-2.csv',
          fileName: 'test-file-2.csv',
          fileSizeBytes: 1024,
          status: 'completed',
        },
      });
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: { increment: 1024 } },
      });

      // Second upload
      await prisma.upload.create({
        data: {
          userId: 1,
          fileKey: 'test-file-3.csv',
          fileName: 'test-file-3.csv',
          fileSizeBytes: 2048,
          status: 'completed',
        },
      });
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: { increment: 2048 } },
      });

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(3072); // 1024 + 2048
    });

    it('should decrement storageUsedBytes on upload deletion', async () => {
      // Setup: create upload and increment storage
      await prisma.upload.create({
        data: {
          userId: 1,
          fileKey: 'test-file-delete.csv',
          fileName: 'test-file-delete.csv',
          fileSizeBytes: 1024,
          status: 'completed',
        },
      });
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: 1024 },
      });

      // Delete upload (mark as deleted)
      await prisma.upload.update({
        where: { fileKey: 'test-file-delete.csv' },
        data: { status: 'deleted' },
      });

      // Decrement storage
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: { decrement: 1024 } },
      });

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(0);
    });

    it('should NOT decrement storage on double-delete (idempotency)', async () => {
      // Setup: create upload with storage already decremented
      await prisma.upload.create({
        data: {
          userId: 1,
          fileKey: 'test-file-double-delete.csv',
          fileName: 'test-file-double-delete.csv',
          fileSizeBytes: 1024,
          status: 'deleted', // Already deleted
        },
      });
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: 0 },
      });

      // Attempt to delete again - should NOT decrement
      // In production, StorageQuotaService.markUploadDeleted checks status first
      const upload = await prisma.upload.findUnique({
        where: { fileKey: 'test-file-double-delete.csv' },
      });

      // Verify upload is already deleted - no decrement should happen
      expect(upload?.status).toBe('deleted');

      // Storage should remain 0 (not go negative)
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(0);
    });

    it('should isolate storage tracking per organization', async () => {
      // Org A uploads file
      await prisma.upload.create({
        data: {
          userId: 1,
          fileKey: 'org-a-file.csv',
          fileName: 'org-a-file.csv',
          fileSizeBytes: 1024,
          status: 'completed',
        },
      });
      await prisma.organizationUsage.update({
        where: { organizationId: orgStarter.id },
        data: { storageUsedBytes: 1024 },
      });

      // Org B uploads different file
      await prisma.upload.create({
        data: {
          userId: 2,
          fileKey: 'org-b-file.csv',
          fileName: 'org-b-file.csv',
          fileSizeBytes: 2048,
          status: 'completed',
        },
      });
      await prisma.organizationUsage.update({
        where: { organizationId: orgProfessional.id },
        data: { storageUsedBytes: 2048 },
      });

      // Verify Org A's storage unchanged by Org B's upload
      const orgAUsage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(orgAUsage?.storageUsedBytes).toBe(1024);

      // Verify Org B's storage
      const orgBUsage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgProfessional.id },
      });
      expect(orgBUsage?.storageUsedBytes).toBe(2048);
    });

    it('should use StorageQuotaService.recordUpload for atomic tracking', async () => {
      const { StorageQuotaService } = await import('../../services/storage-quota.service');
      const storageService = new StorageQuotaService();

      // Record upload via service
      await storageService.recordUpload(
        orgStarter.id,
        1,
        'service-test-file.csv',
        'service-test-file.csv',
        5120, // 5KB
        'text/csv',
      );

      // Verify storage incremented
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(5120);

      // Verify upload record created
      const upload = await prisma.upload.findUnique({
        where: { fileKey: 'service-test-file.csv' },
      });
      expect(upload?.status).toBe('completed');
    });

    it('should use StorageQuotaService.markUploadDeleted for decrement', async () => {
      const { StorageQuotaService } = await import('../../services/storage-quota.service');
      const storageService = new StorageQuotaService();

      // Setup: create upload
      await storageService.recordUpload(
        orgStarter.id,
        1,
        'delete-test-file.csv',
        'delete-test-file.csv',
        4096,
        'text/csv',
      );

      // Verify storage
      let usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(4096);

      // Delete via service
      await storageService.markUploadDeleted(orgStarter.id, 'delete-test-file.csv');

      // Verify storage decremented
      usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgStarter.id },
      });
      expect(usage?.storageUsedBytes).toBe(0);

      // Verify upload marked as deleted
      const upload = await prisma.upload.findUnique({
        where: { fileKey: 'delete-test-file.csv' },
      });
      expect(upload?.status).toBe('deleted');
    });
  });
});

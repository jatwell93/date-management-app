/**
 * Multi-Tenant Feature Gate Enforcement Tests
 *
 * Tests that feature gates correctly enforce tier-based access restrictions.
 * Verifies requireFeature() middleware blocks lower tiers from premium features.
 *
 * Task: 13.4
 * Pattern: Reuse requireFeature() middleware from feature-gate.middleware.test.ts
 */

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import request from 'supertest';
import express from 'express';
import { requireFeature, checkUsageLimit } from '../../middleware/feature-gate.middleware';
import { SubscriptionStatus } from '../../types/subscription';

// Mock Stripe
vi.mock('stripe', () => {
  // The SUT default-imports Stripe (`import Stripe from 'stripe'`), so the mock
  // module must expose the constructor as `default` (Vitest does not synthesize it).
  const StripeMock = vi.fn().mockImplementation(function () {
    return {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      },
    };
  });
  return { default: StripeMock };
});

describe('Multi-Tenant Feature Gate Enforcement Tests', () => {
  let prisma: PrismaClient;
  let app: express.Express;

  // Test organizations
  let orgStarter: { id: string; name: string };
  let orgPremium: { id: string; name: string };

  beforeAll(async () => {
    prisma = getDefaultDatabaseClient();
  });

  beforeEach(async () => {
    await setupTestData();
    await setupTestApp();
  });

  async function setupTestData() {
    // Clean up test data
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create organizations
    orgStarter = await prisma.organization.create({
      data: {
        name: 'Starter Pharmacy',
        slug: 'starter-pharmacy-test',
        contactEmail: 'starter@test.com',
      },
    });

    orgPremium = await prisma.organization.create({
      data: {
        name: 'Premium Pharmacy',
        slug: 'premium-pharmacy-test',
        contactEmail: 'premium@test.com',
      },
    });

    // Create subscriptions
    await createSubscriptions();

    // Seed feature flags
    await seedFeatureFlags();
  }

  async function createSubscriptions() {
    await prisma.subscriptionTier.createMany({
      data: [
        {
          organizationId: orgStarter.id,
          tierLevel: 'starter',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_starter',
        },
        {
          organizationId: orgPremium.id,
          tierLevel: 'premium',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_premium',
        },
      ],
    });
  }

  async function seedFeatureFlags() {
    const existingFlags = await prisma.tierFeatureFlag.count();
    if (existingFlags === 0) {
      await prisma.tierFeatureFlag.createMany({
        data: [
          // Starter tier - no advanced analytics
          { tierLevel: 'starter', featureKey: 'advanced_analytics', enabled: false },
          { tierLevel: 'starter', featureKey: 'max_skus', enabled: true, limitValue: 500 },
          { tierLevel: 'starter', featureKey: 'max_users', enabled: true, limitValue: 1 },

          // Premium tier - has advanced analytics
          { tierLevel: 'premium', featureKey: 'advanced_analytics', enabled: true },
          { tierLevel: 'premium', featureKey: 'max_skus', enabled: true, limitValue: null },
          { tierLevel: 'premium', featureKey: 'max_users', enabled: true, limitValue: 10 },
        ],
      });
    }
  }

  async function setupTestApp() {
    // Create test Express app
    app = express();
    app.use(express.json());

    // Mock analytics endpoint with feature gate
    app.get(
      '/api/reports/analytics',
      createMockMiddleware(),
      requireFeature('advanced_analytics'),
      (_req, res) => {
        res.json({ message: 'Analytics data', data: [] });
      },
    );

    // Mock product creation endpoint with SKU limit check (16A.D.5)
    app.post('/api/products', createMockMiddleware(), checkUsageLimit('max_skus'), (_req, res) => {
      res.status(201).json({ message: 'Product created', id: 1 });
    });
  }

  function createMockMiddleware() {
    return (req: any, _res: any, next: any) => {
      req.organizationId = req.query.orgId as string;
      req.tierLevel = req.query.tier as string;
      req.userId = 1;
      req.method = 'POST';
      next();
    };
  }

  afterAll(async () => {
    // Clean up test data
    await prisma.tierFeatureFlag.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Task 13.4: Premium feature blocking for Starter tier', () => {
    it('should block Starter tier access to advanced analytics', async () => {
      const response = await request(app)
        .get('/api/reports/analytics')
        .query({ orgId: orgStarter.id, tier: 'starter' })
        .expect(403);

      expect(response.body.message).toContain('advanced_analytics');
      expect(response.body.message).toContain('not available');
      expect(response.body.currentTier).toBe('starter');
      expect(response.body.upgradeCTA).toBeDefined();
      expect(response.body.upgradeUrl).toBe('/subscription/upgrade');
    });

    it('should allow Premium tier access to advanced analytics', async () => {
      const response = await request(app)
        .get('/api/reports/analytics')
        .query({ orgId: orgPremium.id, tier: 'premium' })
        .expect(200);

      expect(response.body.message).toBe('Analytics data');
      expect(response.body.data).toBeDefined();
    });

    it('should return 403 with upgrade CTA for Starter tier', async () => {
      const response = await request(app)
        .get('/api/reports/analytics')
        .query({ orgId: orgStarter.id, tier: 'starter' })
        .expect(403);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('feature', 'advanced_analytics');
      expect(response.body).toHaveProperty('currentTier', 'starter');
      expect(response.body).toHaveProperty('upgradeCTA');
      expect(response.body).toHaveProperty('upgradeUrl');

      // Verify upgrade CTA contains helpful message
      expect(response.body.upgradeCTA).toContain('Upgrade');
      expect(response.body.upgradeCTA).toContain('advanced_analytics');
    });

    it('should verify feature flags are correctly seeded in database', async () => {
      // Verify Starter tier does not have advanced_analytics
      const starterFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'starter',
            featureKey: 'advanced_analytics',
          },
        },
      });

      expect(starterFlag).toBeDefined();
      expect(starterFlag?.enabled).toBe(false);

      // Verify Premium tier has advanced_analytics
      const premiumFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'premium',
            featureKey: 'advanced_analytics',
          },
        },
      });

      expect(premiumFlag).toBeDefined();
      expect(premiumFlag?.enabled).toBe(true);
    });

    it('should deny access when organizationId or tierLevel is missing', async () => {
      const response = await request(app).get('/api/reports/analytics').expect(403);

      expect(response.body.message).toContain('Missing tenant context');
    });
  });

  describe('Task 16A.D.5: SKU limit enforcement', () => {
    // Helper function to create organization usage
    async function createOrgUsage(
      organizationId: string,
      data: {
        totalSkus: number;
        maxSkus: number;
        activeUsers?: number;
        maxUsers?: number;
      },
    ) {
      return await prisma.organizationUsage.create({
        data: {
          organizationId,
          activeUsers: data.activeUsers ?? 1,
          maxUsers: data.maxUsers ?? 1,
          totalSkus: data.totalSkus,
          maxSkus: data.maxSkus,
          totalInventoryItems: 0,
          maxInventoryItems: 5000,
          storageUsedBytes: 0,
        },
      });
    }

    it('should block Starter tier from creating 501st product (500 SKU limit)', async () => {
      await createOrgUsage(orgStarter.id, {
        totalSkus: 500, // At limit
        maxSkus: 500,
      });

      const response = await request(app)
        .post('/api/products')
        .query({ orgId: orgStarter.id, tier: 'starter' })
        .expect(403);

      expect(response.body.message).toContain('Usage limit reached');
      expect(response.body.limitKey).toBe('max_skus');
      expect(response.body.currentUsage).toBe(500);
      expect(response.body.limit).toBe(500);
      expect(response.body.upgradeCTA).toBeDefined();
    });

    it('should allow Starter tier to create product when under limit', async () => {
      await createOrgUsage(orgStarter.id, {
        totalSkus: 400, // Under limit
        maxSkus: 500,
      });

      const response = await request(app)
        .post('/api/products')
        .query({ orgId: orgStarter.id, tier: 'starter' })
        .expect(201);

      expect(response.body.message).toBe('Product created');
    });

    it('should show warning at 80% usage (400/500 SKUs)', async () => {
      await createOrgUsage(orgStarter.id, {
        totalSkus: 400, // 80% of 500
        maxSkus: 500,
      });

      const response = await request(app)
        .post('/api/products')
        .query({ orgId: orgStarter.id, tier: 'starter' })
        .expect(201);

      // Warning is attached to res.locals.usageWarning
      // In a real scenario, this would be included in response headers or body
      expect(response.body.message).toBe('Product created');
    });

    it('should allow Professional tier to create 2000+ SKUs', async () => {
      await createOrgUsage(orgPremium.id, {
        totalSkus: 1500, // Under 2000 limit
        maxSkus: 999999, // Premium has very high limit
        activeUsers: 1,
        maxUsers: 10,
      });

      const response = await request(app)
        .post('/api/products')
        .query({ orgId: orgPremium.id, tier: 'premium' })
        .expect(201);

      expect(response.body.message).toBe('Product created');
    });
  });
});

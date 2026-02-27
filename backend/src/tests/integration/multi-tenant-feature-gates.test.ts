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
import { requireFeature } from '../../middleware/feature-gate.middleware';
import { SubscriptionStatus } from '../../types/subscription';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
    },
  }));
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
    // Clean up test data
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create Starter tier organization
    orgStarter = await prisma.organization.create({
      data: {
        name: 'Starter Pharmacy',
        slug: 'starter-pharmacy-test',
        contactEmail: 'starter@test.com',
      },
    });

    // Create Premium tier organization
    orgPremium = await prisma.organization.create({
      data: {
        name: 'Premium Pharmacy',
        slug: 'premium-pharmacy-test',
        contactEmail: 'premium@test.com',
      },
    });

    // Create Starter subscription
    await prisma.subscriptionTier.create({
      data: {
        organizationId: orgStarter.id,
        tierLevel: 'starter',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'monthly',
        stripeCustomerId: 'cus_starter',
      },
    });

    // Create Premium subscription
    await prisma.subscriptionTier.create({
      data: {
        organizationId: orgPremium.id,
        tierLevel: 'premium',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'monthly',
        stripeCustomerId: 'cus_premium',
      },
    });

    // Seed tier feature flags if not already present
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

    // Create test Express app
    app = express();
    app.use(express.json());

    // Mock analytics endpoint with feature gate
    app.get(
      '/api/reports/analytics',
      (req: any, _res, next) => {
        // Mock authentication - inject organizationId and tierLevel
        req.organizationId = req.query.orgId as string;
        req.tierLevel = req.query.tier as string;
        req.userId = 1;
        next();
      },
      requireFeature('advanced_analytics'),
      (_req, res) => {
        res.json({ message: 'Analytics data', data: [] });
      },
    );
  });

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
});

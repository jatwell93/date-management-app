import request from 'supertest';
import express, { Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken, invalidateSubscriptionCache, AuthRequest } from '../../middleware/auth.middleware';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { envConfig } from '../../config/environment';
import { TierLevel } from '../../types/subscription';

const prisma = getDefaultDatabaseClient();

describe('Auth Middleware Tier Override', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Setup Express app with real auth middleware
    app = express();
    app.use(express.json());

    // Create a test endpoint that requires premium tier
    app.get(
      '/api/premium-only',
      authenticateToken,
      (req: AuthRequest, res: Response) => {
        if (req.tierLevel !== 'premium') {
          return res.status(403).json({ error: 'Premium required' });
        }
        return res.status(200).json({ message: 'Success' });
      },
    );
  });

  async function createTestData(tier: TierLevel = 'starter') {
    const org = await prisma.organization.create({
      data: {
        name: 'Test Auth Org ' + Math.random(),
        slug: 'test-auth-org-' + Date.now() + Math.random(),
      },
    });

    const user = await prisma.user.create({
      data: {
        email: `test-auth-${Date.now()}-${Math.random()}@example.com`,
        organizationId: org.id,
        role: 'Manager',
      },
    });

    const sub = await prisma.subscriptionTier.create({
      data: {
        organizationId: org.id,
        tierLevel: tier,
        status: 'active',
        billingCycle: 'monthly',
      },
    });

    return { orgId: org.id, userId: user.id, subId: sub.id };
  }

  async function cleanupTestData(orgId: string) {
    try {
      await prisma.subscriptionTier.deleteMany({ where: { organizationId: orgId } });
      await prisma.refreshToken.deleteMany({ where: { user: { organizationId: orgId } } });
      await prisma.user.deleteMany({ where: { organizationId: orgId } });
      await prisma.organizationUsage.deleteMany({ where: { organizationId: orgId } });
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  it('overrides stale premium token when database says starter', async () => {
    const { orgId, userId } = await createTestData('starter');

    // Ensure TEST_AUTH_BYPASS is off
    const oldBypass = process.env.TEST_AUTH_BYPASS;
    process.env.TEST_AUTH_BYPASS = 'false';

    try {
      // Generate a token claiming to be premium
      const staleToken = jwt.sign(
        {
          userId: userId,
          role: 'Manager',
          organizationId: orgId,
          tierLevel: 'premium', // STALE
        },
        envConfig.JWT_SECRET,
      );

      // Request should be handled by middleware, then rejected by handler
      const res = await request(app)
        .get('/api/premium-only')
        .set('Authorization', `Bearer ${staleToken}`);

      if (res.status !== 403) {
        console.log('Unexpected response status:', res.status);
        console.log('Response body:', res.body);
      }

      expect(res.status).toBe(403);
      // Handler returns 'error'
      expect(res.body.error).toBe('Premium required');
    } finally {
      process.env.TEST_AUTH_BYPASS = oldBypass;
      await cleanupTestData(orgId);
    }
  });

  it('allows access when database is updated to premium and cache is cleared', async () => {
    const { orgId, userId, subId } = await createTestData('starter');

    // Set TEST_AUTH_BYPASS off
    const oldBypass = process.env.TEST_AUTH_BYPASS;
    process.env.TEST_AUTH_BYPASS = 'false';

    try {
      // 1. Update DB to premium
      await prisma.subscriptionTier.update({
        where: { id: subId },
        data: { tierLevel: 'premium' },
      });

      // 2. Clear the cache manually (simulating the webhook action)
      invalidateSubscriptionCache(orgId);

      // 3. Generate a token claiming to be starter
      const staleToken = jwt.sign(
        {
          userId: userId,
          role: 'Manager',
          organizationId: orgId,
          tierLevel: 'starter', // STALE
        },
        envConfig.JWT_SECRET,
      );

      // Request should be allowed (200) because DB override enforces 'premium'
      const res = await request(app)
        .get('/api/premium-only')
        .set('Authorization', `Bearer ${staleToken}`);

      if (res.status !== 200) {
        console.log('Unexpected status in second test:', res.status);
        console.log('Body:', res.body);
      }

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Success');
    } finally {
      process.env.TEST_AUTH_BYPASS = oldBypass;
      await cleanupTestData(orgId);
    }
  });
});

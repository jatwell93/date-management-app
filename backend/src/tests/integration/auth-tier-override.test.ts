import request from 'supertest';
import express, { Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  authenticateToken,
  invalidateSubscriptionCache,
  AuthRequest,
} from '../../middleware/auth.middleware';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { envConfig } from '../../config/environment';
import { TierLevel } from '../../types/subscription';
import { OrganizationService } from '../../services/organization.service';

const prisma = getDefaultDatabaseClient();

describe('Auth Middleware Tier Override', () => {
  let app: express.Application;
  const organizationService = new OrganizationService(prisma);

  beforeAll(async () => {
    // Setup Express app with real auth middleware
    app = express();
    app.use(express.json());

    // Create a test endpoint that requires premium tier
    app.get('/api/premium-only', authenticateToken, (req: AuthRequest, res: Response) => {
      if (req.tierLevel !== 'premium') {
        return res.status(403).json({ error: 'Premium required' });
      }
      return res.status(200).json({ message: 'Success' });
    });
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
      expect(res.headers['x-org-tier-version']).toContain(':starter:');
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
      expect(res.headers['x-org-tier-version']).toContain(':premium:');
    } finally {
      process.env.TEST_AUTH_BYPASS = oldBypass;
      await cleanupTestData(orgId);
    }
  });

  it('hard deletes organization and cascades related records without orphans', async () => {
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const org = await prisma.organization.create({
      data: {
        name: `Cascade Org ${nonce}`,
        slug: `cascade-org-${nonce}`,
        contactEmail: `cascade-${nonce}@example.com`,
      },
    });

    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        clerkUserId: `clerk_${nonce}`,
        email: `user-${nonce}@example.com`,
        username: `user_${nonce}`,
        role: 'Manager',
      },
    });

    await prisma.organizationUsage.create({
      data: {
        organizationId: org.id,
        activeUsers: 1,
        maxUsers: 3,
        totalSkus: 1,
        maxSkus: 2000,
        totalInventoryItems: 1,
        maxInventoryItems: 20000,
        storageUsedBytes: 1024,
      },
    });

    await prisma.subscriptionTier.create({
      data: {
        organizationId: org.id,
        tierLevel: 'professional',
        status: 'active',
        billingCycle: 'monthly',
      },
    });

    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        barcode: `barcode-${nonce}`,
        sku: `sku-${nonce}`,
        name: 'Cascade Product',
        costPrice: 10.5,
      },
    });

    const storeArea = await prisma.storeArea.create({
      data: {
        organizationId: org.id,
        name: 'Main Shelf',
      },
    });

    const inventoryItem = await prisma.inventoryItem.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        locationId: storeArea.id,
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        inventoryItemId: inventoryItem.id,
        action: 'inventory_created',
        changeDescription: 'Created inventory item',
      },
    });

    await prisma.itemTransaction.create({
      data: {
        organizationId: org.id,
        inventoryItemId: inventoryItem.id,
        userId: user.id,
        type: 'stock-in',
        quantityChange: 3,
      },
    });

    await prisma.expiredItemTransaction.create({
      data: {
        organizationId: org.id,
        inventoryItemId: inventoryItem.id,
        userId: user.id,
        action: 'discarded',
        unitsDiscarded: 1,
      },
    });

    await prisma.upload.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        fileKey: `file-key-${nonce}`,
        fileName: 'cascade.csv',
        fileSizeBytes: 512,
        contentType: 'text/csv',
      },
    });

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: `token-${nonce}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await prisma.organizationInvite.create({
      data: {
        organizationId: org.id,
        email: `invite-${nonce}@example.com`,
        role: 'team_member',
        status: 'PENDING',
        inviteTokenHash: `invite-hash-${nonce}`,
        inviteTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        invitedByUserId: user.id,
      },
    });

    await prisma.trialEvent.create({
      data: {
        organizationId: org.id,
        eventType: 'trial_started',
      },
    });

    const deleted = await organizationService.deleteOrganization(org.id);
    expect(deleted).toBe(true);

    const [
      deletedOrg,
      userCount,
      productCount,
      inventoryCount,
      uploadCount,
      subscriptionCount,
      usageCount,
      auditCount,
      inviteCount,
      trialCount,
      itemTxCount,
      expiredTxCount,
    ] = await Promise.all([
      prisma.organization.findUnique({ where: { id: org.id } }),
      prisma.user.count({ where: { organizationId: org.id } }),
      prisma.product.count({ where: { organizationId: org.id } }),
      prisma.inventoryItem.count({ where: { organizationId: org.id } }),
      prisma.upload.count({ where: { organizationId: org.id } }),
      prisma.subscriptionTier.count({ where: { organizationId: org.id } }),
      prisma.organizationUsage.count({ where: { organizationId: org.id } }),
      prisma.auditLog.count({ where: { organizationId: org.id } }),
      prisma.organizationInvite.count({ where: { organizationId: org.id } }),
      prisma.trialEvent.count({ where: { organizationId: org.id } }),
      prisma.itemTransaction.count({ where: { organizationId: org.id } }),
      prisma.expiredItemTransaction.count({ where: { organizationId: org.id } }),
    ]);

    expect(deletedOrg).toBeNull();
    expect(userCount).toBe(0);
    expect(productCount).toBe(0);
    expect(inventoryCount).toBe(0);
    expect(uploadCount).toBe(0);
    expect(subscriptionCount).toBe(0);
    expect(usageCount).toBe(0);
    expect(auditCount).toBe(0);
    expect(inviteCount).toBe(0);
    expect(trialCount).toBe(0);
    expect(itemTxCount).toBe(0);
    expect(expiredTxCount).toBe(0);
  });
});

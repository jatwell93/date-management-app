import { OrganizationInviteService } from '../../services/organization-invite.service';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { getDefaultDatabaseClient } from '../../database/database-factory';

describe('OrganizationInviteService Security', () => {
  let service: OrganizationInviteService;
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = getDefaultDatabaseClient();
    service = new OrganizationInviteService(prisma, () => new Date());

    // Mock the user limit check to avoid subscription setup complexity
    jest.spyOn(service as any, 'ensureWithinUserLimit').mockResolvedValue(undefined);

    // Set up test data to satisfy foreign key constraints
    await prisma.organization.upsert({
      where: { id: 'test-org' },
      update: {},
      create: {
        id: 'test-org',
        name: 'Test Organization',
        slug: 'test-org',
        clerkOrganizationId: 'clerk_org_123',
      },
    });

    await prisma.user.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        email: 'inviter@example.com',
        role: 'admin',
        organizationId: 'test-org',
      },
    });
  });

  describe('Token Security', () => {
    it('should not store plain text tokens in database', async () => {
      const params = {
        organizationId: 'test-org',
        invitedByUserId: 1,
        email: 'test@example.com',
        role: 'team_member' as const,
      };

      const invite = await service.createInvite(params);

      // Verify token hash exists
      expect(invite.inviteTokenHash).toBeDefined();
      expect(invite.inviteTokenHash).not.toBe('');

      // Verify plain token is returned for email but not stored in database
      expect(invite.token).toBeDefined();
      expect(invite.token).not.toBe(invite.inviteTokenHash); // Plain token should differ from hash

      // Verify plain token is NOT actually stored in database
      const dbInvite = await prisma.organizationInvite.findUnique({
        where: { id: invite.id },
      });
      expect(dbInvite?.token).toBeUndefined(); // Plain token should not exist in DB
      expect(dbInvite?.inviteTokenHash).toBe(invite.inviteTokenHash); // Hash should be stored
    });

    it('should clear token hash when invite is accepted', async () => {
      // First create an invite
      const params = {
        organizationId: 'test-org',
        invitedByUserId: 1,
        email: 'test@example.com',
        role: 'team_member' as const,
      };

      const invite = await service.createInvite(params);
      expect(invite.inviteTokenHash).toBeDefined();

      // Accept the invite
      await service.acceptInvite({
        token: invite.token,
        clerkUserId: 'clerk_123',
        email: 'test@example.com',
      });

      // Verify token hash is cleared (one-time use)
      const updatedInvite = await prisma.organizationInvite.findUnique({
        where: { id: invite.id },
      });

      expect(updatedInvite?.inviteTokenHash).toBeNull();
    });

    it('should clear token hash when invite is revoked', async () => {
      // First create an invite
      const params = {
        organizationId: 'test-org',
        invitedByUserId: 1,
        email: 'test@example.com',
        role: 'team_member' as const,
      };

      const invite = await service.createInvite(params);
      expect(invite.inviteTokenHash).toBeDefined();

      // Revoke the invite
      await service.revokeInvite(params.organizationId, invite.id, params.invitedByUserId);

      // Verify token hash is cleared
      const updatedInvite = await prisma.organizationInvite.findUnique({
        where: { id: invite.id },
      });

      expect(updatedInvite?.inviteTokenHash).toBeNull();
    });

    it('accepts legacy token format for backward compatibility', async () => {
      const legacyToken = 'legacy-token-without-id-prefix';
      const legacyHash = await bcrypt.hash(legacyToken, 12);

      const invite = await prisma.organizationInvite.create({
        data: {
          organizationId: 'test-org',
          email: 'legacy@example.com',
          role: 'team_member',
          inviteTokenHash: legacyHash,
          inviteTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          invitedByUserId: 1,
        },
      });

      const result = await service.acceptInvite({
        token: legacyToken,
        clerkUserId: 'clerk_legacy_123',
        email: 'legacy@example.com',
      });

      expect(result.invite.id).toBe(invite.id);
      expect(result.invite.status).toBe('ACCEPTED');

      const updatedInvite = await prisma.organizationInvite.findUnique({
        where: { id: invite.id },
      });

      expect(updatedInvite?.inviteTokenHash).toBeNull();
    });
  });
});

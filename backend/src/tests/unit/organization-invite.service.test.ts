import { PrismaClient } from '@prisma/client';
import { OrganizationInviteService } from '../../services/organization-invite.service';
import { ConflictError, NotFoundError, PaymentRequiredError, ValidationError } from '../../errors';

const now = new Date('2026-02-17T00:00:00.000Z');

describe('OrganizationInviteService', () => {
  let service: OrganizationInviteService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      subscriptionTier: {
        findFirst: jest.fn(),
      },
      user: {
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      organizationInvite: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (arg: any) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg(mockPrisma);
      }),
    };

    service = new OrganizationInviteService(
      mockPrisma as unknown as PrismaClient,
      () => now,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createInvite', () => {
    it('creates an invite when under user limit', async () => {
      mockPrisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.organizationInvite.count.mockResolvedValue(0);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.organizationInvite.findFirst.mockResolvedValue(null);
      mockPrisma.organizationInvite.create.mockResolvedValue({
        id: 'invite-1',
        organizationId: 'org-1',
        email: 'user@example.com',
        role: 'member',
        token: 'token',
        status: 'PENDING',
        expiresAt: new Date('2026-02-24T00:00:00.000Z'),
        invitedByUserId: 1,
        createdAt: now,
      });

      const invite = await service.createInvite({
        organizationId: 'org-1',
        invitedByUserId: 1,
        email: 'User@Example.com',
        role: 'member',
      });

      expect(invite.email).toBe('user@example.com');
      expect(mockPrisma.organizationInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            email: 'user@example.com',
            role: 'member',
            status: 'PENDING',
            invitedByUserId: 1,
            token: expect.any(String),
          }),
        }),
      );
    });

    it('throws when user limit reached', async () => {
      mockPrisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
      mockPrisma.user.count.mockResolvedValue(3);
      mockPrisma.organizationInvite.count.mockResolvedValue(0);

      await expect(
        service.createInvite({
          organizationId: 'org-1',
          invitedByUserId: 1,
          email: 'user@example.com',
          role: 'member',
        }),
      ).rejects.toBeInstanceOf(PaymentRequiredError);
    });

    it('throws when invite already pending', async () => {
      mockPrisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.organizationInvite.count.mockResolvedValue(0);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.organizationInvite.findFirst.mockResolvedValue({ id: 'invite-1' });

      await expect(
        service.createInvite({
          organizationId: 'org-1',
          invitedByUserId: 1,
          email: 'user@example.com',
          role: 'member',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('acceptInvite', () => {
    it('accepts a valid invite and creates user', async () => {
      mockPrisma.organizationInvite.findFirst.mockResolvedValue({
        id: 'invite-1',
        organizationId: 'org-1',
        role: 'member',
        status: 'PENDING',
        expiresAt: new Date('2026-02-20T00:00:00.000Z'),
      });
      mockPrisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.organizationInvite.count.mockResolvedValue(0);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 10, organizationId: 'org-1' });
      mockPrisma.organizationInvite.update.mockResolvedValue({
        id: 'invite-1',
        organizationId: 'org-1',
        status: 'ACCEPTED',
      });

      const result = await service.acceptInvite({
        token: 'token',
        clerkUserId: 'user_123',
        email: 'user@example.com',
        username: 'user',
      });

      expect(result.invite.status).toBe('ACCEPTED');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            clerkUserId: 'user_123',
            email: 'user@example.com',
            username: 'user',
            role: 'Team Member',
          }),
        }),
      );
    });

    it('marks expired invites as expired', async () => {
      mockPrisma.organizationInvite.findFirst.mockResolvedValue({
        id: 'invite-1',
        organizationId: 'org-1',
        role: 'member',
        status: 'PENDING',
        expiresAt: new Date('2026-02-10T00:00:00.000Z'),
      });
      mockPrisma.organizationInvite.update.mockResolvedValue({ id: 'invite-1' });

      await expect(
        service.acceptInvite({
          token: 'token',
          clerkUserId: 'user_123',
          email: 'user@example.com',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws when invite not found', async () => {
      mockPrisma.organizationInvite.findFirst.mockResolvedValue(null);

      await expect(
        service.acceptInvite({
          token: 'token',
          clerkUserId: 'user_123',
          email: 'user@example.com',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listPendingInvites', () => {
    it('returns pending invites for organization', async () => {
      mockPrisma.organizationInvite.findMany.mockResolvedValue([{ id: 'invite-1' }]);

      const result = await service.listPendingInvites('org-1');

      expect(result).toEqual([{ id: 'invite-1' }]);
      expect(mockPrisma.organizationInvite.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('revokeInvite', () => {
    it('revokes a pending invite', async () => {
      mockPrisma.organizationInvite.findFirst.mockResolvedValue({
        id: 'invite-1',
        status: 'PENDING',
      });
      mockPrisma.organizationInvite.update.mockResolvedValue({ id: 'invite-1', status: 'REVOKED' });

      const invite = await service.revokeInvite('org-1', 'invite-1');

      expect(invite.status).toBe('REVOKED');
    });

    it('rejects revoke for non-pending invites', async () => {
      mockPrisma.organizationInvite.findFirst.mockResolvedValue({
        id: 'invite-1',
        status: 'ACCEPTED',
      });

      await expect(service.revokeInvite('org-1', 'invite-1')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});

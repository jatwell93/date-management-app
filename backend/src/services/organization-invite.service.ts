import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import {
  ConflictError,
  NotFoundError,
  PaymentRequiredError,
  ValidationError,
} from '../errors';
import { TIER_LIMITS, TierLevel } from '../types/subscription';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
export type InviteRole = 'admin' | 'member';

export interface CreateInviteParams {
  organizationId: string;
  invitedByUserId: number;
  email: string;
  role: InviteRole;
}

export interface AcceptInviteParams {
  token: string;
  clerkUserId: string;
  email: string;
  username?: string | null;
}

export class OrganizationInviteService {
  private prisma: PrismaClient;
  private nowProvider: () => Date;

  constructor(
    prismaClient?: PrismaClient,
    nowProvider?: () => Date,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.nowProvider = nowProvider ?? (() => new Date());
  }

  async createInvite(params: CreateInviteParams) {
    const normalizedEmail = params.email.trim().toLowerCase();

    await this.ensureWithinUserLimit(params.organizationId);

    const existingUser = await this.prisma.user.findFirst({
      where: {
        organizationId: params.organizationId,
        email: normalizedEmail,
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictError('User already exists for this organization');
    }

    const existingInvite = await this.prisma.organizationInvite.findFirst({
      where: {
        organizationId: params.organizationId,
        email: normalizedEmail,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (existingInvite) {
      throw new ConflictError('Invite already pending for this email');
    }

    const token = this.generateToken();
    const expiresAt = new Date(this.nowProvider().getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.organizationInvite.create({
      data: {
        organizationId: params.organizationId,
        email: normalizedEmail,
        role: params.role,
        token,
        status: 'PENDING',
        expiresAt,
        invitedByUserId: params.invitedByUserId,
      },
    });
  }

  async listPendingInvites(organizationId: string) {
    return this.prisma.organizationInvite.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(organizationId: string, inviteId: string) {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: {
        id: inviteId,
        organizationId,
      },
    });

    if (!invite) {
      throw new NotFoundError('Invite not found');
    }

    if (invite.status !== 'PENDING') {
      throw new ValidationError('Only pending invites can be revoked');
    }

    return this.prisma.organizationInvite.update({
      where: { id: inviteId },
      data: { status: 'REVOKED' },
    });
  }

  async acceptInvite(params: AcceptInviteParams) {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: { token: params.token },
    });

    if (!invite) {
      throw new NotFoundError('Invite not found');
    }

    if (invite.status !== 'PENDING') {
      throw new ValidationError('Invite is no longer valid');
    }

    const now = this.nowProvider();
    if (invite.expiresAt < now) {
      await this.prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { status: 'EXPIRED' },
      });
      throw new ValidationError('Invite has expired');
    }

    await this.ensureWithinUserLimit(invite.organizationId);

    const normalizedEmail = params.email.trim().toLowerCase();

    const result = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          organizationId: invite.organizationId,
          email: normalizedEmail,
        },
        select: { id: true },
      });

      if (existingUser) {
        throw new ConflictError('User already exists for this organization');
      }

      const role = this.mapInviteRole(invite.role as InviteRole);
      const createdUser = await tx.user.create({
        data: {
          organizationId: invite.organizationId,
          clerkUserId: params.clerkUserId,
          email: normalizedEmail,
          username: params.username ?? null,
          role,
        },
      });

      const updatedInvite = await tx.organizationInvite.update({
        where: { id: invite.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: now,
        },
      });

      return { invite: updatedInvite, user: createdUser };
    });

    return result;
  }

  private mapInviteRole(role: InviteRole) {
    return role === 'admin' ? 'Manager' : 'Team Member';
  }

  private async ensureWithinUserLimit(organizationId: string) {
    const subscription = await this.prisma.subscriptionTier.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundError('Organization subscription not configured');
    }

    const tierLevel = subscription.tierLevel as TierLevel;
    const maxUsers = TIER_LIMITS[tierLevel]?.max_users;

    if (!maxUsers) {
      return;
    }

    const [activeUsers, pendingInvites] = await this.prisma.$transaction([
      this.prisma.user.count({
        where: { organizationId },
      }),
      this.prisma.organizationInvite.count({
        where: {
          organizationId,
          status: 'PENDING',
        },
      }),
    ]);

    if (activeUsers + pendingInvites >= maxUsers) {
      throw new PaymentRequiredError('User limit reached for current tier');
    }
  }

  private generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }
}

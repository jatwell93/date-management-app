import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { ConflictError, NotFoundError, PaymentRequiredError, ValidationError } from '../errors';
import { TIER_LIMITS, TierLevel } from '../types/subscription';
import { RoleValue, isValidRole } from '../constants/roles';
import { OrgAuditService } from './org-audit.service';
import { AUDIT_EVENT_TYPES } from '../constants/roles';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface CreateInviteParams {
  organizationId: string;
  invitedByUserId: number;
  email: string;
  role: RoleValue;
}

export interface AcceptInviteParams {
  token: string;
  clerkUserId: string;
  email: string;
  username?: string | null;
}

const BCRYPT_COST = 12;
const TOKEN_BYTES = 32;
const LEGACY_TOKEN_FALLBACK_MAX_CANDIDATES = 25;

export class OrganizationInviteService {
  private prisma: PrismaClient;
  private nowProvider: () => Date;
  private auditService: OrgAuditService;

  constructor(prismaClient?: PrismaClient, nowProvider?: () => Date) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.nowProvider = nowProvider ?? (() => new Date());
    this.auditService = new OrgAuditService(this.prisma);
  }

  async createInvite(params: CreateInviteParams) {
    const normalizedEmail = params.email.trim().toLowerCase();

    if (!isValidRole(params.role)) {
      throw new ValidationError(`Invalid role: ${params.role}`);
    }

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

    const inviteId = crypto.randomUUID();
    const tokenSecret = this.generateTokenSecret();
    const plainToken = this.buildInviteToken(inviteId, tokenSecret);
    const tokenHash = await bcrypt.hash(plainToken, BCRYPT_COST);
    const expiresAt = new Date(this.nowProvider().getTime() + 7 * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.organizationInvite.create({
      data: {
        id: inviteId,
        organizationId: params.organizationId,
        email: normalizedEmail,
        role: params.role,
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: expiresAt,
        status: 'PENDING',
        expiresAt,
        invitedByUserId: params.invitedByUserId,
      },
    });

    try {
      await this.auditService.emit({
        organizationId: params.organizationId,
        eventType: AUDIT_EVENT_TYPES.INVITE_CREATED,
        actorUserId: params.invitedByUserId,
        actorOrganizationId: params.organizationId,
        newRole: params.role,
        inviteId: invite.id,
        metadata: { email: normalizedEmail },
      });
    } catch (error) {
      // Audit failure should not block invite creation
      console.error('Failed to emit invite creation audit event', {
        error,
        organizationId: params.organizationId,
        inviteId: invite.id,
        email: normalizedEmail,
      });
    }

    // Return the invite with the plain token for email sending
    // The plain token is NOT stored in the database, only the hash
    return {
      ...invite,
      token: plainToken, // Temporary token for email, not persisted
    };
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

  async revokeInvite(organizationId: string, inviteId: string, actorUserId?: number) {
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

    const revoked = await this.prisma.organizationInvite.update({
      where: { id: inviteId },
      data: { status: 'REVOKED', inviteTokenHash: null },
    });

    try {
      await this.auditService.emit({
        organizationId,
        eventType: AUDIT_EVENT_TYPES.INVITE_REVOKED,
        actorUserId: actorUserId ?? null,
        actorOrganizationId: organizationId,
        inviteId: invite.id,
        metadata: { email: invite.email },
      });
    } catch {
      // Audit failure should not block revocation
    }

    return revoked;
  }

  async resendInvite(organizationId: string, inviteId: string, actorUserId?: number) {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: {
        id: inviteId,
        organizationId,
        status: 'PENDING',
      },
    });

    if (!invite) {
      throw new NotFoundError('Pending invite not found');
    }

    const tokenSecret = this.generateTokenSecret();
    const plainToken = this.buildInviteToken(invite.id, tokenSecret);
    const tokenHash = await bcrypt.hash(plainToken, BCRYPT_COST);
    const expiresAt = new Date(this.nowProvider().getTime() + 7 * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.organizationInvite.update({
      where: { id: inviteId },
      data: {
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: expiresAt,
        expiresAt,
      },
    });

    try {
      await this.auditService.emit({
        organizationId,
        eventType: AUDIT_EVENT_TYPES.INVITE_RESENT,
        actorUserId: actorUserId ?? null,
        actorOrganizationId: organizationId,
        inviteId: invite.id,
        metadata: { email: invite.email },
      });
    } catch {
      // Audit failure should not block resend
    }

    // Return the invite with the plain token for email sending
    // The plain token is NOT stored in the database, only the hash
    return {
      ...updated,
      token: plainToken, // Temporary token for email, not persisted
    };
  }

  async acceptInvite(params: AcceptInviteParams) {
    const invite = await this.findPendingInviteForToken(params.token);

    if (!invite) {
      throw new NotFoundError('Invite not found or invalid');
    }

    if (this.isInviteExpired(invite)) {
      const expiredTransitionCount = await this.markInviteAsExpired(invite.id);
      if (expiredTransitionCount === 0 && invite.status !== 'EXPIRED') {
        throw new ValidationError('Invite is no longer valid');
      }
      throw new ValidationError('Invite has expired');
    }

    if (invite.status !== 'PENDING') {
      throw new ValidationError('Invite is no longer valid');
    }

    // Verify email matches the invite
    const normalizedEmail = params.email.trim().toLowerCase();
    if (normalizedEmail !== invite.email.trim().toLowerCase()) {
      throw new ValidationError('Email does not match invite');
    }

    await this.ensureWithinUserLimit(invite.organizationId);

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

      // Use canonical role directly (no legacy mapping needed)
      const createdUser = await tx.user.create({
        data: {
          organizationId: invite.organizationId,
          clerkUserId: params.clerkUserId,
          email: normalizedEmail,
          username: params.username ?? null,
          role: invite.role,
        },
      });

      // Mark invite as accepted and clear token hash (one-time use)
      const now = this.nowProvider();
      const updatedInvite = await tx.organizationInvite.update({
        where: { id: invite.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: now,
          inviteTokenHash: null,
        },
      });

      return { invite: updatedInvite, user: createdUser };
    });

    try {
      await this.auditService.emit({
        organizationId: invite.organizationId,
        eventType: AUDIT_EVENT_TYPES.INVITE_ACCEPTED,
        targetUserId: result.user.id,
        targetOrganizationId: invite.organizationId,
        newRole: invite.role,
        inviteId: invite.id,
        metadata: { email: normalizedEmail },
      });
    } catch {
      // Audit failure should not block invite acceptance
    }

    return result;
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

  private async findPendingInviteForToken(token: string) {
    const inviteId = this.parseInviteToken(token);

    if (inviteId) {
      const candidate = await this.prisma.organizationInvite.findFirst({
        where: {
          id: inviteId,
          status: 'PENDING',
        },
      });

      if (!candidate?.inviteTokenHash) {
        return null;
      }

      const isMatch = await bcrypt.compare(token, candidate.inviteTokenHash);
      return isMatch ? candidate : null;
    }

    // Backward-compatibility fallback for previously issued token format.
    const pendingInvites = await this.prisma.organizationInvite.findMany({
      where: {
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      take: LEGACY_TOKEN_FALLBACK_MAX_CANDIDATES,
    });

    for (const candidate of pendingInvites) {
      if (candidate.inviteTokenHash && (await bcrypt.compare(token, candidate.inviteTokenHash))) {
        return candidate;
      }
    }

    return null;
  }

  private isInviteExpired(invite: { expiresAt: Date | null; inviteTokenExpiresAt: Date | null }) {
    const now = this.nowProvider().getTime();
    const expiresAt = invite.expiresAt?.getTime();
    const inviteTokenExpiresAt = invite.inviteTokenExpiresAt?.getTime();

    if (expiresAt != null && expiresAt <= now) {
      return true;
    }

    if (inviteTokenExpiresAt != null && inviteTokenExpiresAt <= now) {
      return true;
    }

    return false;
  }

  private async markInviteAsExpired(inviteId: string) {
    const result = await this.prisma.organizationInvite.updateMany({
      where: {
        id: inviteId,
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
        inviteTokenHash: null,
      },
    });

    return result.count;
  }

  private parseInviteToken(token: string): string | null {
    const separatorIndex = token.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      return null;
    }

    const inviteId = token.slice(0, separatorIndex);
    const tokenSecret = token.slice(separatorIndex + 1);
    if (!tokenSecret) {
      return null;
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(inviteId)) {
      return null;
    }

    return inviteId;
  }

  private buildInviteToken(inviteId: string, tokenSecret: string): string {
    return `${inviteId}.${tokenSecret}`;
  }

  private generateTokenSecret(): string {
    return crypto.randomBytes(TOKEN_BYTES).toString('hex');
  }
}

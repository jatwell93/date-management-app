import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import type { RoleValue } from '../constants/roles';
import type { InviteStatus } from '../services/organization-invite.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface InviteCreateData {
  id: string;
  organizationId: string;
  email: string;
  role: RoleValue;
  inviteTokenHash: string;
  inviteTokenExpiresAt: Date;
  status: InviteStatus;
  expiresAt: Date;
  invitedByUserId: number;
}

export interface InviteUpdateData {
  status?: InviteStatus;
  inviteTokenHash?: string | null;
  inviteTokenExpiresAt?: Date;
  expiresAt?: Date;
  acceptedAt?: Date;
}

@injectable()
export class OrganizationInviteRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) { }

  private getClient(client?: DbClient): DbClient {
    return client ?? this.prisma;
  }

  async findPendingByOrgAndEmail(
    organizationId: string,
    email: string,
    client?: DbClient,
  ) {
    return this.getClient(client).organizationInvite.findFirst({
      where: {
        organizationId,
        email,
        status: 'PENDING',
      },
      select: { id: true },
    });
  }

  async findByIdAndOrg(inviteId: string, organizationId: string, client?: DbClient) {
    return this.getClient(client).organizationInvite.findFirst({
      where: {
        id: inviteId,
        organizationId,
      },
    });
  }

  async findPendingByIdAndOrg(inviteId: string, organizationId: string, client?: DbClient) {
    return this.getClient(client).organizationInvite.findFirst({
      where: {
        id: inviteId,
        organizationId,
        status: 'PENDING',
      },
    });
  }

  async findPendingById(inviteId: string, client?: DbClient) {
    return this.getClient(client).organizationInvite.findFirst({
      where: {
        id: inviteId,
        status: 'PENDING',
      },
    });
  }

  async findRecentPending(limit: number, client?: DbClient) {
    return this.getClient(client).organizationInvite.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listPendingByOrg(organizationId: string, client?: DbClient) {
    return this.getClient(client).organizationInvite.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countPendingByOrg(organizationId: string, client?: DbClient) {
    return this.getClient(client).organizationInvite.count({
      where: {
        organizationId,
        status: 'PENDING',
      },
    });
  }

  async create(data: InviteCreateData, client?: DbClient) {
    return this.getClient(client).organizationInvite.create({ data });
  }

  async update(inviteId: string, data: InviteUpdateData, client?: DbClient) {
    return this.getClient(client).organizationInvite.update({
      where: { id: inviteId },
      data,
    });
  }

  async markExpired(inviteId: string, client?: DbClient) {
    const result = await this.getClient(client).organizationInvite.updateMany({
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
}

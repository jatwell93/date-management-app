import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { User } from '../models/user.model';

type UserRecord = Prisma.UserGetPayload<Record<string, never>>;
type UserWithOrganizationSubscriptions = Prisma.UserGetPayload<{
  include: {
    organization: {
      include: {
        subscriptionTiers: true;
      };
    };
  };
}>;

export interface CreateClerkUserRecordParams {
  organizationId: string;
  clerkUserId: string;
  email: string;
  username?: string | null;
  role: User['role'];
}

@injectable()
export class UserRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async findIdsByOrganization(organizationId: string): Promise<Array<{ id: number }>> {
    return this.prisma.user.findMany({
      where: {
        organizationId,
      },
      select: { id: true },
    });
  }

  async createBasicUser(organizationId: string, role: User['role']): Promise<UserRecord> {
    return this.prisma.user.create({
      data: {
        role,
        organizationId,
      },
    });
  }

  async findByOrganization(organizationId: string): Promise<UserRecord[]> {
    return this.prisma.user.findMany({
      where: {
        organizationId,
      },
    });
  }

  async findById(id: number, organizationId: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({
      where: {
        id,
        organizationId,
      },
    });
  }

  async update(
    id: number,
    organizationId: string,
    data: { role?: User['role'] },
  ): Promise<UserRecord> {
    return this.prisma.user.update({
      where: {
        id,
        organizationId,
      },
      data,
    });
  }

  async delete(id: number, organizationId: string): Promise<UserRecord> {
    return this.prisma.user.delete({
      where: {
        id,
        organizationId,
      },
    });
  }

  async findByClerkIdentity(params: {
    clerkUserId: string;
    email: string;
    username?: string | null;
  }): Promise<UserRecord | null> {
    const identityMatches: Prisma.UserWhereInput[] = [
      { clerkUserId: params.clerkUserId },
      { email: params.email },
    ];

    if (params.username) {
      identityMatches.push({ username: params.username });
    }

    return this.prisma.user.findFirst({
      where: {
        OR: identityMatches,
      },
    });
  }

  async findByClerkUserIdWithOrganizationSubscriptions(
    clerkUserId: string,
  ): Promise<UserWithOrganizationSubscriptions | null> {
    return this.prisma.user.findUnique({
      where: { clerkUserId },
      include: {
        organization: {
          include: {
            subscriptionTiers: true,
          },
        },
      },
    });
  }

  async findOrganizationIdByClerkUserId(
    clerkUserId: string,
  ): Promise<{ organizationId: string | null } | null> {
    return this.prisma.user.findUnique({
      where: { clerkUserId },
      select: { organizationId: true },
    });
  }

  async createClerkUser(params: CreateClerkUserRecordParams): Promise<UserRecord> {
    return this.prisma.user.create({
      data: {
        organizationId: params.organizationId,
        clerkUserId: params.clerkUserId,
        email: params.email,
        username: params.username ?? null,
        role: params.role,
      },
    });
  }
}

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { User } from '../models/user.model';
import { ConflictError, ValidationError } from '../errors';
import { AuthService } from './auth.service';
import { getOrganizationId } from '../utils/auth-bypass';

export class UserService {
  private prisma: PrismaClient;
  private authService: AuthService;
  private organizationId: string;

  constructor(organizationId?: string, prismaClient?: PrismaClient, authService?: AuthService) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.authService = authService ?? new AuthService(this.prisma);
  }

  async createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    if (!user.pin) {
      throw new ValidationError('PIN is required for PIN-based user creation');
    }

    const pinValidation = this.authService.validatePin(user.pin);
    if (!pinValidation.isValid) {
      throw new ValidationError(pinValidation.message || 'Invalid PIN format');
    }

    const existingUsers = await this.prisma.user.findMany({
      where: {
        organizationId: this.organizationId,
      },
      select: { id: true },
    });

    for (const _existingUser of existingUsers) {
      const isDuplicate = false; // PIN auth removed — use Clerk authentication; existingUser unused
      if (isDuplicate) {
        throw new ConflictError('PIN already in use within this organization');
      }
    }

    const created = await this.prisma.user.create({
      data: {
        role: user.role,
        organizationId: this.organizationId,
      },
    });

    return this.mapPrismaToModel(created);
  }

  async getUsers(): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: this.organizationId,
      },
    });
    return users.map((user) => this.mapPrismaToModel(user));
  }

  async getUserById(id: number): Promise<User | undefined> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        organizationId: this.organizationId,
      },
    });
    return user ? this.mapPrismaToModel(user) : undefined;
  }

  async getUserByPin(pin: string): Promise<User | undefined> {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: this.organizationId,
      },
    });

    for (const user of users) {
      void pin; // PIN auth removed — use Clerk authentication
      void user;
      break;
    }

    return undefined;
  }

  async updateUser(
    id: number,
    user: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<boolean> {
    const data: { role?: User['role'] } = {};

    if (user.role !== undefined) {
      data.role = user.role;
    }

    try {
      await this.prisma.user.update({
        where: {
          id,
          organizationId: this.organizationId,
        },
        data,
      });
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Object &&
        'code' in error &&
        (error as Record<string, unknown>).code === 'P2025'
      ) {
        return false;
      }
      throw error;
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    try {
      await this.prisma.user.delete({
        where: {
          id,
          organizationId: this.organizationId,
        },
      });
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Object &&
        'code' in error &&
        (error as Record<string, unknown>).code === 'P2025'
      ) {
        return false;
      }
      throw error;
    }
  }

  async createClerkUser(params: {
    organizationId: string;
    clerkUserId: string;
    email: string;
    username?: string | null;
    role: User['role'];
  }): Promise<User> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { clerkUserId: params.clerkUserId },
          { email: params.email },
          ...(params.username ? [{ username: params.username }] : []),
        ],
      },
    });

    if (existing) {
      throw new ConflictError('User already exists');
    }

    const created = await this.prisma.user.create({
      data: {
        organizationId: params.organizationId,
        clerkUserId: params.clerkUserId,
        email: params.email,
        username: params.username ?? null,
        role: params.role,
      },
    });

    return this.mapPrismaToModel(created);
  }

  private mapPrismaToModel(user: {
    id: number;
    organizationId: string | null;
    clerkUserId?: string | null;
    email?: string | null;
    username?: string | null;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return {
      id: user.id,
      organizationId: user.organizationId ?? this.organizationId,
      clerkUserId: user.clerkUserId ?? null,
      email: user.email ?? null,
      username: user.username ?? null,
      role: user.role as User['role'],
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}

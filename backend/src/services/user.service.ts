import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { User } from '../models/user.model';
import { ConflictError, ValidationError } from '../errors';
import { AuthService } from './auth.service';

export class UserService {
  private prisma: PrismaClient;
  private authService: AuthService;
  private organizationId: string;

  constructor(organizationId?: string, prismaClient?: PrismaClient, authService?: AuthService) {
    this.organizationId = organizationId ?? 'default-org';
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.authService = authService ?? new AuthService(this.prisma);
  }

  async createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    const pinValidation = this.authService.validatePin(user.pin);
    if (!pinValidation.isValid) {
      throw new ValidationError(pinValidation.message || 'Invalid PIN format');
    }

    const existingUsers = await this.prisma.user.findMany({
      where: {
        organizationId: this.organizationId,
      },
      select: { id: true, pin: true },
    });

    for (const existingUser of existingUsers) {
      const isDuplicate = await this.authService.verifyPin(user.pin, existingUser.pin);
      if (isDuplicate) {
        throw new ConflictError('PIN already in use within this organization');
      }
    }

    const hashedPin = await this.authService.hashPin(user.pin);

    const created = await this.prisma.user.create({
      data: {
        pin: hashedPin,
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
      const isValid = await this.authService.verifyPin(pin, user.pin);
      if (isValid) {
        return this.mapPrismaToModel(user);
      }
    }

    return undefined;
  }

  async updateUser(
    id: number,
    user: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<boolean> {
    const data: { pin?: string; role?: User['role'] } = {};

    if (user.pin) {
      const pinValidation = this.authService.validatePin(user.pin);
      if (!pinValidation.isValid) {
        throw new Error(pinValidation.message || 'Invalid PIN format');
      }

      data.pin = await this.authService.hashPin(user.pin);
    }

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

  private mapPrismaToModel(user: {
    id: number;
    organizationId: string | null;
    pin: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return {
      id: user.id,
      organizationId: user.organizationId ?? this.organizationId,
      pin: user.pin,
      role: user.role as User['role'],
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}

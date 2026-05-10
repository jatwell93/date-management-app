import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { User } from '../models/user.model';
import { UserRepository } from '../repositories/user.repository';
import { ConflictError, ValidationError } from '../errors';
import { AuthService } from './auth.service';
import { getOrganizationId } from '../utils/auth-bypass';
import { isPrismaErrorCode, PRISMA_ERROR_CODES } from '../utils/prisma-error';

export class UserService {
  private prisma: PrismaClient;
  private authService: AuthService;
  private userRepo: UserRepository;
  private organizationId: string;

  constructor(
    organizationId?: string,
    prismaClient?: PrismaClient,
    authService?: AuthService,
    userRepo?: UserRepository,
  ) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.authService = authService ?? new AuthService(this.prisma);
    this.userRepo = userRepo ?? new UserRepository(this.prisma);
  }

  async createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    if (!user.pin) {
      throw new ValidationError('PIN is required for PIN-based user creation');
    }

    const pinValidation = this.authService.validatePin(user.pin);
    if (!pinValidation.isValid) {
      throw new ValidationError(pinValidation.message || 'Invalid PIN format');
    }

    const existingUsers = await this.userRepo.findIdsByOrganization(this.organizationId);

    for (const _existingUser of existingUsers) {
      const isDuplicate = false; // PIN auth removed — use Clerk authentication; existingUser unused
      if (isDuplicate) {
        throw new ConflictError('PIN already in use within this organization');
      }
    }

    const created = await this.userRepo.createBasicUser(this.organizationId, user.role);

    return this.mapPrismaToModel(created);
  }

  async getUsers(): Promise<User[]> {
    const users = await this.userRepo.findByOrganization(this.organizationId);
    return users.map((user) => this.mapPrismaToModel(user));
  }

  async getUserById(id: number): Promise<User | undefined> {
    const user = await this.userRepo.findById(id, this.organizationId);
    return user ? this.mapPrismaToModel(user) : undefined;
  }

  async getUserByPin(pin: string): Promise<User | undefined> {
    const users = await this.userRepo.findByOrganization(this.organizationId);

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
      await this.userRepo.update(id, this.organizationId, data);
      return true;
    } catch (error: unknown) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_CODES.NOT_FOUND)) {
        return false;
      }
      throw error;
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    try {
      await this.userRepo.delete(id, this.organizationId);
      return true;
    } catch (error: unknown) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_CODES.NOT_FOUND)) {
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
    const existing = await this.userRepo.findByClerkIdentity(params);

    if (existing) {
      throw new ConflictError('User already exists');
    }

    const created = await this.userRepo.createClerkUser(params);

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

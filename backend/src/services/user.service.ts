import { PrismaClient } from './generated/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

export class UserService {
  private prisma: PrismaClient;
  private authService: AuthService;

  constructor(prismaClient?: PrismaClient, authService?: AuthService) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.authService = authService ?? new AuthService(this.prisma);
  }

  async createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    const pinValidation = this.authService.validatePin(user.pin);
    if (!pinValidation.isValid) {
      throw new Error(pinValidation.message || 'Invalid PIN format');
    }

    const hashedPin = await this.authService.hashPin(user.pin);

    const created = await this.prisma.user.create({
      data: {
        pin: hashedPin,
        role: user.role,
      },
    });

    return this.mapPrismaToModel(created);
  }

  async getUsers(): Promise<User[]> {
    const users = await this.prisma.user.findMany();
    return users.map((user) => this.mapPrismaToModel(user));
  }

  async getUserById(id: number): Promise<User | undefined> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? this.mapPrismaToModel(user) : undefined;
  }

  async getUserByPin(pin: string): Promise<User | undefined> {
    const users = await this.prisma.user.findMany();

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
        where: { id },
        data,
      });
      return true;
    } catch (error: any) {
      if (error?.code === 'P2025') {
        return false;
      }
      throw error;
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    try {
      await this.prisma.user.delete({ where: { id } });
      return true;
    } catch (error: any) {
      if (error?.code === 'P2025') {
        return false;
      }
      throw error;
    }
  }

  private mapPrismaToModel(user: {
    id: number;
    pin: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return {
      id: user.id,
      pin: user.pin,
      role: user.role as User['role'],
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}

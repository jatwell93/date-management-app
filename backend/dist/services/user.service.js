"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const database_factory_1 = require("../database/database-factory");
const errors_1 = require("../errors");
const auth_service_1 = require("./auth.service");
const auth_bypass_1 = require("../utils/auth-bypass");
class UserService {
    constructor(organizationId, prismaClient, authService) {
        this.organizationId = (0, auth_bypass_1.getOrganizationId)(organizationId);
        this.prisma = prismaClient ?? (0, database_factory_1.getDefaultDatabaseClient)();
        this.authService = authService ?? new auth_service_1.AuthService(this.prisma);
    }
    async createUser(user) {
        if (!user.pin) {
            throw new errors_1.ValidationError('PIN is required for PIN-based user creation');
        }
        const pinValidation = this.authService.validatePin(user.pin);
        if (!pinValidation.isValid) {
            throw new errors_1.ValidationError(pinValidation.message || 'Invalid PIN format');
        }
        const existingUsers = await this.prisma.user.findMany({
            where: {
                organizationId: this.organizationId,
            },
            select: { id: true },
        });
        for (const existingUser of existingUsers) {
            const isDuplicate = false; // PIN auth removed — use Clerk authentication; existingUser unused
            if (isDuplicate) {
                throw new errors_1.ConflictError('PIN already in use within this organization');
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
    async getUsers() {
        const users = await this.prisma.user.findMany({
            where: {
                organizationId: this.organizationId,
            },
        });
        return users.map((user) => this.mapPrismaToModel(user));
    }
    async getUserById(id) {
        const user = await this.prisma.user.findFirst({
            where: {
                id,
                organizationId: this.organizationId,
            },
        });
        return user ? this.mapPrismaToModel(user) : undefined;
    }
    async getUserByPin(pin) {
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
    async updateUser(id, user) {
        const data = {};
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
        }
        catch (error) {
            if (error instanceof Object &&
                'code' in error &&
                error.code === 'P2025') {
                return false;
            }
            throw error;
        }
    }
    async deleteUser(id) {
        try {
            await this.prisma.user.delete({
                where: {
                    id,
                    organizationId: this.organizationId,
                },
            });
            return true;
        }
        catch (error) {
            if (error instanceof Object &&
                'code' in error &&
                error.code === 'P2025') {
                return false;
            }
            throw error;
        }
    }
    async createClerkUser(params) {
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
            throw new errors_1.ConflictError('User already exists');
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
    mapPrismaToModel(user) {
        return {
            id: user.id,
            organizationId: user.organizationId ?? this.organizationId,
            clerkUserId: user.clerkUserId ?? null,
            email: user.email ?? null,
            username: user.username ?? null,
            role: user.role,
            created_at: user.createdAt.toISOString(),
            updated_at: user.updatedAt.toISOString(),
        };
    }
}
exports.UserService = UserService;

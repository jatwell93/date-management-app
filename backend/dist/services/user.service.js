"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const database_factory_1 = require("../database/database-factory");
const errors_1 = require("../errors");
const auth_service_1 = require("./auth.service");
class UserService {
    constructor(prismaClient, authService) {
        this.prisma = prismaClient ?? (0, database_factory_1.getDefaultDatabaseClient)();
        this.authService = authService ?? new auth_service_1.AuthService(this.prisma);
    }
    async createUser(user) {
        const pinValidation = this.authService.validatePin(user.pin);
        if (!pinValidation.isValid) {
            throw new errors_1.ValidationError(pinValidation.message || 'Invalid PIN format');
        }
        const existingUsers = await this.prisma.user.findMany({
            select: { id: true, pin: true },
        });
        for (const existingUser of existingUsers) {
            const isDuplicate = await this.authService.verifyPin(user.pin, existingUser.pin);
            if (isDuplicate) {
                throw new errors_1.ConflictError('PIN already in use');
            }
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
    async getUsers() {
        const users = await this.prisma.user.findMany();
        return users.map((user) => this.mapPrismaToModel(user));
    }
    async getUserById(id) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        return user ? this.mapPrismaToModel(user) : undefined;
    }
    async getUserByPin(pin) {
        const users = await this.prisma.user.findMany();
        for (const user of users) {
            const isValid = await this.authService.verifyPin(pin, user.pin);
            if (isValid) {
                return this.mapPrismaToModel(user);
            }
        }
        return undefined;
    }
    async updateUser(id, user) {
        const data = {};
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
            await this.prisma.user.delete({ where: { id } });
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
    mapPrismaToModel(user) {
        return {
            id: user.id,
            pin: user.pin,
            role: user.role,
            created_at: user.createdAt.toISOString(),
            updated_at: user.updatedAt.toISOString(),
        };
    }
}
exports.UserService = UserService;

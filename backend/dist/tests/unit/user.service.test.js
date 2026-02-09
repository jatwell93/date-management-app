"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const user_service_1 = require("../../services/user.service");
const errors_1 = require("../../errors");
describe('UserService', () => {
    let prisma;
    let authService;
    let service;
    const createdAt = new Date('2023-01-01T00:00:00.000Z');
    const updatedAt = new Date('2023-01-02T00:00:00.000Z');
    beforeEach(() => {
        prisma = {
            user: {
                create: jest.fn(),
                findMany: jest.fn(),
                findUnique: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
        };
        authService = {
            validatePin: jest.fn(),
            hashPin: jest.fn(),
            verifyPin: jest.fn(),
        };
        service = new user_service_1.UserService(prisma, authService);
        jest.clearAllMocks();
    });
    describe('createUser', () => {
        it('creates a user with a hashed PIN', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            authService.verifyPin.mockResolvedValue(false);
            authService.hashPin.mockResolvedValue('hashed_pin');
            prisma.user.findMany.mockResolvedValue([]);
            prisma.user.create.mockResolvedValue({
                id: 1,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.createUser({ pin: '123456', role: 'Manager' });
            expect(authService.validatePin).toHaveBeenCalledWith('123456');
            expect(prisma.user.findMany).toHaveBeenCalledWith({
                select: { id: true, pin: true },
            });
            expect(authService.hashPin).toHaveBeenCalledWith('123456');
            expect(prisma.user.create).toHaveBeenCalledWith({
                data: {
                    pin: 'hashed_pin',
                    role: 'Manager',
                },
            });
            expect(result).toEqual({
                id: 1,
                pin: 'hashed_pin',
                role: 'Manager',
                created_at: createdAt.toISOString(),
                updated_at: updatedAt.toISOString(),
            });
        });
        it('throws ConflictError when PIN is already in use', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            authService.verifyPin.mockResolvedValue(true);
            prisma.user.findMany.mockResolvedValue([
                { id: 2, pin: 'existing_hashed_pin' },
            ]);
            await expect(service.createUser({ pin: '123456', role: 'Manager' })).rejects.toBeInstanceOf(errors_1.ConflictError);
            expect(prisma.user.create).not.toHaveBeenCalled();
        });
    });
    describe('getUsers', () => {
        it('returns all users', async () => {
            prisma.user.findMany.mockResolvedValue([
                { id: 1, pin: 'hashed_pin', role: 'Manager', createdAt, updatedAt },
            ]);
            const result = await service.getUsers();
            expect(prisma.user.findMany).toHaveBeenCalledWith();
            expect(result).toEqual([
                {
                    id: 1,
                    pin: 'hashed_pin',
                    role: 'Manager',
                    created_at: createdAt.toISOString(),
                    updated_at: updatedAt.toISOString(),
                },
            ]);
        });
    });
    describe('getUserById', () => {
        it('returns a user when found', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 1,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.getUserById(1);
            expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
            expect(result?.id).toBe(1);
        });
        it('returns undefined when user is not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const result = await service.getUserById(999);
            expect(result).toBeUndefined();
        });
    });
    describe('getUserByPin', () => {
        it('returns user when PIN matches', async () => {
            prisma.user.findMany.mockResolvedValue([
                { id: 1, pin: 'hashed_pin', role: 'Manager', createdAt, updatedAt },
            ]);
            authService.verifyPin.mockResolvedValue(true);
            const result = await service.getUserByPin('123456');
            expect(authService.verifyPin).toHaveBeenCalledWith('123456', 'hashed_pin');
            expect(result?.id).toBe(1);
        });
        it('returns undefined when no PIN matches', async () => {
            prisma.user.findMany.mockResolvedValue([
                { id: 1, pin: 'hashed_pin', role: 'Manager', createdAt, updatedAt },
            ]);
            authService.verifyPin.mockResolvedValue(false);
            const result = await service.getUserByPin('9999');
            expect(result).toBeUndefined();
        });
    });
    describe('updateUser', () => {
        it('updates a user and returns true', async () => {
            prisma.user.update.mockResolvedValue({
                id: 1,
                pin: 'hashed_pin',
                role: 'Team Member',
                createdAt,
                updatedAt,
            });
            const result = await service.updateUser(1, { role: 'Team Member' });
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { role: 'Team Member' },
            });
            expect(result).toBe(true);
        });
        it('hashes PIN updates', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            authService.hashPin.mockResolvedValue('hashed_pin');
            prisma.user.update.mockResolvedValue({
                id: 1,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.updateUser(1, { pin: '123456' });
            expect(authService.validatePin).toHaveBeenCalledWith('123456');
            expect(authService.hashPin).toHaveBeenCalledWith('123456');
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { pin: 'hashed_pin' },
            });
            expect(result).toBe(true);
        });
        it('returns false when user is not found', async () => {
            const notFoundError = { code: 'P2025' };
            prisma.user.update.mockRejectedValue(notFoundError);
            const result = await service.updateUser(999, { role: 'Team Member' });
            expect(result).toBe(false);
        });
    });
    describe('deleteUser', () => {
        it('deletes a user and returns true', async () => {
            prisma.user.delete.mockResolvedValue({
                id: 1,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.deleteUser(1);
            expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 1 } });
            expect(result).toBe(true);
        });
        it('returns false when user is not found', async () => {
            const notFoundError = { code: 'P2025' };
            prisma.user.delete.mockRejectedValue(notFoundError);
            const result = await service.deleteUser(999);
            expect(result).toBe(false);
        });
    });
});

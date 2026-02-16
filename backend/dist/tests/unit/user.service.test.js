"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const user_service_1 = require("../../services/user.service");
const errors_1 = require("../../errors");
describe('UserService', () => {
    let prisma;
    let authService;
    let service;
    const testOrganizationId = 'org-123';
    const createdAt = new Date('2023-01-01T00:00:00.000Z');
    const updatedAt = new Date('2023-01-02T00:00:00.000Z');
    beforeEach(() => {
        prisma = {
            user: {
                create: jest.fn(),
                findMany: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
        };
        authService = {
            validatePin: jest.fn(),
            hashPin: jest.fn(),
            verifyPin: jest.fn(),
        };
        service = new user_service_1.UserService(testOrganizationId, prisma, authService);
        jest.clearAllMocks();
    });
    describe('createUser', () => {
        it('creates a user with organizationId and hashed PIN', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            authService.verifyPin.mockResolvedValue(false);
            authService.hashPin.mockResolvedValue('hashed_pin');
            prisma.user.findMany.mockResolvedValue([]);
            prisma.user.create.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.createUser({
                pin: '123456',
                role: 'Manager',
                organizationId: testOrganizationId,
            });
            expect(authService.validatePin).toHaveBeenCalledWith('123456');
            expect(prisma.user.findMany).toHaveBeenCalledWith({
                where: {
                    organizationId: testOrganizationId,
                },
                select: { id: true, pin: true },
            });
            expect(authService.hashPin).toHaveBeenCalledWith('123456');
            expect(prisma.user.create).toHaveBeenCalledWith({
                data: {
                    organizationId: testOrganizationId,
                    pin: 'hashed_pin',
                    role: 'Manager',
                },
            });
            expect(result).toEqual({
                id: 1,
                organizationId: testOrganizationId,
                pin: 'hashed_pin',
                role: 'Manager',
                created_at: createdAt.toISOString(),
                updated_at: updatedAt.toISOString(),
            });
        });
        it('throws ConflictError when PIN is already in use within organization', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            authService.verifyPin.mockResolvedValue(true);
            prisma.user.findMany.mockResolvedValue([
                { id: 2, pin: 'existing_hashed_pin' },
            ]);
            await expect(service.createUser({ pin: '123456', role: 'Manager', organizationId: testOrganizationId })).rejects.toBeInstanceOf(errors_1.ConflictError);
            expect(prisma.user.create).not.toHaveBeenCalled();
        });
    });
    describe('getUsers', () => {
        it('returns all users for the organization', async () => {
            prisma.user.findMany.mockResolvedValue([
                {
                    id: 1,
                    organizationId: testOrganizationId,
                    pin: 'hashed_pin',
                    role: 'Manager',
                    createdAt,
                    updatedAt,
                },
            ]);
            const result = await service.getUsers();
            expect(prisma.user.findMany).toHaveBeenCalledWith({
                where: {
                    organizationId: testOrganizationId,
                },
            });
            expect(result).toEqual([
                {
                    id: 1,
                    organizationId: testOrganizationId,
                    pin: 'hashed_pin',
                    role: 'Manager',
                    created_at: createdAt.toISOString(),
                    updated_at: updatedAt.toISOString(),
                },
            ]);
        });
    });
    describe('getUserById', () => {
        it('returns a user when found in organization', async () => {
            prisma.user.findFirst.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.getUserById(1);
            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId: testOrganizationId,
                },
            });
            expect(result?.id).toBe(1);
        });
        it('returns undefined when user is not found in organization', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            const result = await service.getUserById(999);
            expect(result).toBeUndefined();
        });
    });
    describe('getUserByPin', () => {
        it('returns user when PIN matches within organization', async () => {
            prisma.user.findMany.mockResolvedValue([
                {
                    id: 1,
                    organizationId: testOrganizationId,
                    pin: 'hashed_pin',
                    role: 'Manager',
                    createdAt,
                    updatedAt,
                },
            ]);
            authService.verifyPin.mockResolvedValue(true);
            const result = await service.getUserByPin('123456');
            expect(prisma.user.findMany).toHaveBeenCalledWith({
                where: {
                    organizationId: testOrganizationId,
                },
            });
            expect(authService.verifyPin).toHaveBeenCalledWith('123456', 'hashed_pin');
            expect(result?.id).toBe(1);
        });
        it('returns undefined when no PIN matches in organization', async () => {
            prisma.user.findMany.mockResolvedValue([
                {
                    id: 1,
                    organizationId: testOrganizationId,
                    pin: 'hashed_pin',
                    role: 'Manager',
                    createdAt,
                    updatedAt,
                },
            ]);
            authService.verifyPin.mockResolvedValue(false);
            const result = await service.getUserByPin('9999');
            expect(result).toBeUndefined();
        });
    });
    describe('updateUser', () => {
        it('updates a user in organization and returns true', async () => {
            prisma.user.update.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
                pin: 'hashed_pin',
                role: 'Team Member',
                createdAt,
                updatedAt,
            });
            const result = await service.updateUser(1, { role: 'Team Member' });
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId: testOrganizationId,
                },
                data: { role: 'Team Member' },
            });
            expect(result).toBe(true);
        });
        it('hashes PIN updates', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            authService.hashPin.mockResolvedValue('hashed_pin');
            prisma.user.update.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.updateUser(1, { pin: '123456' });
            expect(authService.validatePin).toHaveBeenCalledWith('123456');
            expect(authService.hashPin).toHaveBeenCalledWith('123456');
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId: testOrganizationId,
                },
                data: { pin: 'hashed_pin' },
            });
            expect(result).toBe(true);
        });
        it('returns false when user is not found in organization', async () => {
            const notFoundError = { code: 'P2025' };
            prisma.user.update.mockRejectedValue(notFoundError);
            const result = await service.updateUser(999, { role: 'Team Member' });
            expect(result).toBe(false);
        });
    });
    describe('deleteUser', () => {
        it('deletes a user in organization and returns true', async () => {
            prisma.user.delete.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
                pin: 'hashed_pin',
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            const result = await service.deleteUser(1);
            expect(prisma.user.delete).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId: testOrganizationId,
                },
            });
            expect(result).toBe(true);
        });
        it('returns false when user is not found in organization', async () => {
            const notFoundError = { code: 'P2025' };
            prisma.user.delete.mockRejectedValue(notFoundError);
            const result = await service.deleteUser(999);
            expect(result).toBe(false);
        });
    });
});

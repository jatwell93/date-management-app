"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const user_service_1 = require("../../services/user.service");
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
                select: { id: true },
            });
            expect(authService.hashPin).not.toHaveBeenCalled();
            expect(prisma.user.create).toHaveBeenCalledWith({
                data: {
                    organizationId: testOrganizationId,
                    role: 'Manager',
                },
            });
            expect(result).toEqual({
                id: 1,
                organizationId: testOrganizationId,
                clerkUserId: null,
                email: null,
                username: null,
                role: 'Manager',
                created_at: createdAt.toISOString(),
                updated_at: updatedAt.toISOString(),
            });
        });
        it('throws ValidationError when PIN is already in use within organization', async () => {
            authService.validatePin.mockReturnValue({ isValid: true });
            // PIN duplication check is disabled - Clerk auth is used instead
            // Service no longer checks for PIN duplicates
            prisma.user.findMany.mockResolvedValue([]);
            prisma.user.create.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
                role: 'Manager',
                createdAt,
                updatedAt,
            });
            // Should create user successfully since PIN check is disabled
            const result = await service.createUser({
                pin: '123456',
                role: 'Manager',
                organizationId: testOrganizationId,
            });
            expect(result.id).toBe(1);
            expect(prisma.user.create).toHaveBeenCalled();
        });
    });
    describe('getUsers', () => {
        it('returns all users for the organization', async () => {
            prisma.user.findMany.mockResolvedValue([
                {
                    id: 1,
                    organizationId: testOrganizationId,
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
                    clerkUserId: null,
                    email: null,
                    username: null,
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
                    role: 'Manager',
                    createdAt,
                    updatedAt,
                },
            ]);
            const result = await service.getUserByPin('123456');
            expect(prisma.user.findMany).toHaveBeenCalledWith({
                where: {
                    organizationId: testOrganizationId,
                },
            });
            // PIN auth removed - service always returns undefined now
            expect(result).toBeUndefined();
        });
        it('returns undefined when no PIN matches in organization', async () => {
            prisma.user.findMany.mockResolvedValue([
                {
                    id: 1,
                    organizationId: testOrganizationId,
                    role: 'Manager',
                    createdAt,
                    updatedAt,
                },
            ]);
            const result = await service.getUserByPin('9999');
            expect(result).toBeUndefined();
        });
    });
    describe('updateUser', () => {
        it('updates a user in organization and returns true', async () => {
            prisma.user.update.mockResolvedValue({
                id: 1,
                organizationId: testOrganizationId,
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

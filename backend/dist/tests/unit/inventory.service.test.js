"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const inventory_service_1 = require("../../services/inventory.service");
describe('InventoryService', () => {
    let inventoryService;
    let mockPrisma;
    const organizationId = 'org-123';
    beforeEach(() => {
        mockPrisma = {
            inventoryItem: {
                create: jest.fn(),
                update: jest.fn(),
                findUnique: jest.fn(),
                findMany: jest.fn(),
                findFirst: jest.fn(),
                delete: jest.fn(),
            },
            product: {
                findFirst: jest.fn(),
            },
            storeArea: {
                findFirst: jest.fn(),
            },
            user: {
                findFirst: jest.fn(),
            },
            auditLog: {
                create: jest.fn(),
            },
            itemTransaction: {
                create: jest.fn(),
            },
            organizationUsage: {
                update: jest.fn(),
                findUnique: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(mockPrisma)),
        };
        inventoryService = new inventory_service_1.InventoryService(organizationId, mockPrisma);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('createInventoryItem', () => {
        it('should create a new inventory item with organization filtering', async () => {
            const newItemData = {
                productId: 1,
                expiryDate: '2025-12-31',
                locationId: 1,
                status: 'Normal',
            };
            const mockCreatedItem = {
                id: 1,
                ...newItemData,
                organizationId,
                expiryDate: new Date(newItemData.expiryDate),
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            // Mock product and location validation
            mockPrisma.product.findFirst.mockResolvedValue({ id: 1, organizationId });
            mockPrisma.storeArea.findFirst.mockResolvedValue({ id: 1, organizationId });
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(null); // No existing item
            mockPrisma.inventoryItem.create.mockResolvedValue(mockCreatedItem);
            mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
            mockPrisma.organizationUsage.update.mockResolvedValue({});
            const createdItem = await inventoryService.createInventoryItem(newItemData, 1);
            expect(createdItem.id).toBe(1);
            expect(createdItem.status).toBe('Normal');
            expect(mockPrisma.product.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.storeArea.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.inventoryItem.create).toHaveBeenCalledWith({
                data: {
                    organizationId,
                    productId: 1,
                    expiryDate: new Date('2025-12-31'),
                    locationId: 1,
                    status: 'Normal',
                },
            });
            expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
                where: { organizationId },
                data: { totalInventoryItems: { increment: 1 } },
            });
            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: {
                    organizationId,
                    userId: 1,
                    inventoryItemId: 1,
                    action: 'inventory_changed',
                    changeDescription: expect.any(String),
                },
            });
        });
        it('should throw error if product does not belong to organization', async () => {
            const newItemData = {
                productId: 1,
                expiryDate: '2025-12-31',
                locationId: 1,
                status: 'Normal',
            };
            mockPrisma.inventoryItem.findFirst
                .mockResolvedValueOnce(null) // No existing item
                .mockResolvedValueOnce(null); // Product not found in org
            await expect(inventoryService.createInventoryItem(newItemData, 1)).rejects.toThrow('Product not found or does not belong to this organization');
        });
        it('should throw error if location does not belong to organization', async () => {
            const newItemData = {
                productId: 1,
                expiryDate: '2025-12-31',
                locationId: 1,
                status: 'Normal',
            };
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(null); // No existing item
            mockPrisma.product.findFirst.mockResolvedValue({ id: 1, organizationId }); // Product exists in org
            mockPrisma.storeArea.findFirst.mockResolvedValue(null); // Location not found in org
            await expect(inventoryService.createInventoryItem(newItemData, 1)).rejects.toThrow('Location not found or does not belong to this organization');
        });
    });
    describe('updateInventoryItem', () => {
        it('should update an inventory item status with organization filtering', async () => {
            const mockItem = {
                id: 1,
                productId: 1,
                locationId: 1,
                expiryDate: new Date(),
                status: 'Normal',
                createdAt: new Date(),
                updatedAt: new Date(),
                product: { organizationId },
            };
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
            mockPrisma.inventoryItem.update.mockResolvedValue({
                ...mockItem,
                status: 'Markdown 1',
            });
            mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
            const updatedItem = await inventoryService.updateInventoryItem(1, { status: 'Markdown 1' }, 1);
            expect(updatedItem).not.toBeNull();
            expect(updatedItem?.status).toBe('Markdown 1');
            expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.inventoryItem.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { status: 'Markdown 1' },
            });
            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: {
                    organizationId,
                    userId: 1,
                    inventoryItemId: 1,
                    action: 'inventory_changed',
                    changeDescription: expect.any(String),
                },
            });
        });
        it('should return null if inventory item does not exist or does not belong to organization', async () => {
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
            const updatedItem = await inventoryService.updateInventoryItem(999, { status: 'Expired' }, 1);
            expect(updatedItem).toBeNull();
            expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 999,
                    organizationId,
                },
            });
        });
    });
    describe('getAllInventoryItems', () => {
        it('should return all inventory items for the organization', async () => {
            const mockItems = [
                {
                    id: 1,
                    productId: 1,
                    locationId: 1,
                    organizationId,
                    expiryDate: new Date(),
                    status: 'Normal',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];
            mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);
            const items = await inventoryService.getAllInventoryItems();
            expect(items).toHaveLength(1);
            expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
                where: {
                    organizationId,
                },
            });
        });
    });
    describe('getInventoryItemsByProductId', () => {
        it('should return inventory items for a specific product within organization', async () => {
            const mockItems = [
                {
                    id: 1,
                    productId: 1,
                    locationId: 1,
                    organizationId,
                    expiryDate: new Date(),
                    status: 'Normal',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];
            mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);
            const items = await inventoryService.getInventoryItemsByProductId(1);
            expect(items).toHaveLength(1);
            expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
                where: {
                    productId: 1,
                    organizationId,
                },
            });
        });
    });
    describe('getRecentInventoryItemsByProductId', () => {
        it('should return recent inventory items for a specific product within organization', async () => {
            const mockItems = [
                {
                    id: 1,
                    productId: 1,
                    locationId: 1,
                    organizationId,
                    expiryDate: new Date(),
                    status: 'Normal',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];
            mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);
            const items = await inventoryService.getRecentInventoryItemsByProductId(1, 5);
            expect(items).toHaveLength(1);
            expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
                where: {
                    productId: 1,
                    organizationId,
                },
                orderBy: { createdAt: 'desc' },
                take: 5,
            });
        });
    });
    describe('getInventoryItemsByLocationId', () => {
        it('should return inventory items for a specific location within organization', async () => {
            const mockItems = [
                {
                    id: 1,
                    productId: 1,
                    locationId: 1,
                    organizationId,
                    expiryDate: new Date(),
                    status: 'Normal',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];
            mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);
            const items = await inventoryService.getInventoryItemsByLocationId(1);
            expect(items).toHaveLength(1);
            expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
                where: {
                    locationId: 1,
                    organizationId,
                },
            });
        });
    });
    describe('deleteInventoryItem', () => {
        it('should delete inventory item and create audit log if item belongs to organization', async () => {
            const mockItem = {
                id: 1,
                productId: 1,
                locationId: 1,
                expiryDate: new Date(),
                status: 'Normal',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
            mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
            mockPrisma.auditLog.create.mockResolvedValue({});
            mockPrisma.inventoryItem.delete.mockResolvedValue(mockItem);
            mockPrisma.organizationUsage.findUnique.mockResolvedValue({
                organizationId,
                totalInventoryItems: 10,
            });
            mockPrisma.organizationUsage.update.mockResolvedValue({});
            const result = await inventoryService.deleteInventoryItem(1, 1);
            expect(result).toBe(true);
            expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: {
                    organizationId,
                    userId: 1,
                    inventoryItemId: 1,
                    action: 'inventory_changed',
                    changeDescription: 'Inventory item with ID 1 deleted.',
                },
            });
            expect(mockPrisma.inventoryItem.delete).toHaveBeenCalledWith({
                where: { id: 1 },
            });
            expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
                where: { organizationId },
                data: { totalInventoryItems: { decrement: 1 } },
            });
        });
        it('should return false if inventory item does not exist or does not belong to organization', async () => {
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
            const result = await inventoryService.deleteInventoryItem(999, 1);
            expect(result).toBe(false);
        });
    });
    describe('autoCalculateMarkdownStatus', () => {
        it('should update markdown status for inventory item within organization', async () => {
            const mockItem = {
                id: 1,
                productId: 1,
                locationId: 1,
                expiryDate: new Date(),
                status: 'Normal',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
            mockPrisma.inventoryItem.update.mockResolvedValue({ ...mockItem, status: 'Expired' });
            await inventoryService.autoCalculateMarkdownStatus(1, '2020-01-01');
            expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.inventoryItem.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { status: 'Expired' },
            });
        });
        it('should throw error if inventory item does not belong to organization', async () => {
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
            await expect(inventoryService.autoCalculateMarkdownStatus(1, '2025-12-31')).rejects.toThrow('Inventory item not found or does not belong to this organization');
        });
    });
    describe('logTransaction', () => {
        it('should log transaction for inventory item within organization', async () => {
            const mockItem = {
                id: 1,
                productId: 1,
                locationId: 1,
                expiryDate: new Date(),
                status: 'Normal',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
            mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
            mockPrisma.itemTransaction.create.mockResolvedValue({ id: 1 });
            const transactionId = await inventoryService.logTransaction({
                inventory_item_id: 1,
                user_id: 1,
                type: 'in',
                quantity_change: 10,
                notes: 'Test transaction',
            });
            expect(transactionId).toBe(1);
            expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 1,
                    organizationId,
                },
            });
            expect(mockPrisma.itemTransaction.create).toHaveBeenCalledWith({
                data: {
                    organizationId,
                    inventoryItemId: 1,
                    userId: 1,
                    type: 'in',
                    quantityChange: 10,
                    notes: 'Test transaction',
                },
            });
        });
        it('should throw error if inventory item does not belong to organization', async () => {
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
            await expect(inventoryService.logTransaction({
                inventory_item_id: 1,
                user_id: 1,
                type: 'in',
                quantity_change: 10,
                notes: 'Test transaction',
            })).rejects.toThrow('Inventory item not found or does not belong to this organization');
        });
        it('should throw error if user does not belong to organization', async () => {
            const mockItem = {
                id: 1,
                productId: 1,
                locationId: 1,
                expiryDate: new Date(),
                status: 'Normal',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
            mockPrisma.user.findFirst.mockResolvedValue(null);
            await expect(inventoryService.logTransaction({
                inventory_item_id: 1,
                user_id: 1,
                type: 'in',
                quantity_change: 10,
                notes: 'Test transaction',
            })).rejects.toThrow('User not found or does not belong to this organization');
        });
    });
    describe('calculateMarkdownStatusSync', () => {
        it('should return "Expired" for dates in the past', () => {
            const date = new Date();
            date.setDate(date.getDate() - 1);
            const expiryDate = date.toISOString().split('T')[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Expired');
        });
        it('should return "Markdown 3" for dates within the next 7 days', () => {
            const date = new Date();
            date.setDate(date.getDate() + 7);
            const expiryDate = date.toISOString().split('T')[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 3');
        });
        it("should return 'Markdown 2' for dates between 8 and 14 days from now", () => {
            const date = new Date();
            date.setDate(date.getDate() + 14);
            const expiryDate = date.toISOString().split('T')[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 2');
        });
        it("should return 'Markdown 1' for dates between 15 and 30 days from now", () => {
            const date = new Date();
            date.setDate(date.getDate() + 30);
            const expiryDate = date.toISOString().split('T')[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 1');
        });
        it('should return "Normal" for dates more than 30 days from now', () => {
            const date = new Date();
            date.setDate(date.getDate() + 31);
            const expiryDate = date.toISOString().split('T')[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Normal');
        });
    });
});

import { InventoryRepository } from '../../repositories/inventory.repository';

describe('InventoryRepository', () => {
  const organizationId = 'org-123';
  const now = new Date('2026-01-01T00:00:00.000Z');

  const inventoryRecord = {
    id: 1,
    organizationId,
    productId: 10,
    locationId: 20,
    expiryDate: now,
    status: 'Normal',
    createdAt: now,
    updatedAt: now,
  };

  let prisma: {
    inventoryItem: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let repository: InventoryRepository;

  beforeEach(() => {
    prisma = {
      inventoryItem: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    repository = new InventoryRepository(prisma as never);
  });

  it('finds all inventory items for an organization', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([inventoryRecord]);

    const result = await repository.findAll(organizationId);

    expect(result).toEqual([inventoryRecord]);
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { organizationId },
    });
  });

  it('finds an inventory item by id within an organization', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue(inventoryRecord);

    const result = await repository.findById(1, organizationId);

    expect(result).toBe(inventoryRecord);
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: 1, organizationId },
    });
  });

  it('finds inventory items by product within an organization', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([inventoryRecord]);

    await repository.findByProductId(10, organizationId);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { productId: 10, organizationId },
    });
  });

  it('finds recent inventory items by product within an organization', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([inventoryRecord]);

    await repository.findRecentByProductId(10, organizationId, 5);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { productId: 10, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('finds inventory items by location within an organization', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([inventoryRecord]);

    await repository.findByLocationId(20, organizationId);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { locationId: 20, organizationId },
    });
  });
});

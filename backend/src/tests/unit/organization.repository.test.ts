import { OrganizationRepository } from '../../repositories/organization.repository';

describe('OrganizationRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const organization = {
    id: 'org-123',
    name: 'Test Organization',
    slug: 'test-org',
    createdAt: now,
    updatedAt: now,
  };

  let prisma: {
    organization: {
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    user: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    auditLog: { deleteMany: jest.Mock };
    itemTransaction: { deleteMany: jest.Mock };
    expiredItemTransaction: { deleteMany: jest.Mock };
    upload: { deleteMany: jest.Mock };
    organizationInvite: { deleteMany: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    inventoryItem: { deleteMany: jest.Mock };
    storeArea: { deleteMany: jest.Mock };
    product: { deleteMany: jest.Mock };
    subscriptionTier: { deleteMany: jest.Mock };
    trialEvent: { deleteMany: jest.Mock };
    organizationUsage: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: OrganizationRepository;

  beforeEach(() => {
    prisma = {
      organization: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      itemTransaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      expiredItemTransaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      upload: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organizationInvite: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      inventoryItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storeArea: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      product: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      subscriptionTier: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trialEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organizationUsage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (operation: (tx: typeof prisma) => Promise<void>) =>
        operation(prisma),
      ),
    };
    repository = new OrganizationRepository(prisma as never);
  });

  it('finds an organization by id', async () => {
    prisma.organization.findUnique.mockResolvedValue(organization);

    const result = await repository.findById('org-123');

    expect(result).toBe(organization);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-123' },
    });
  });

  it('updates only provided organization fields', async () => {
    prisma.organization.update.mockResolvedValue(organization);

    await repository.update('org-123', { name: 'New Name' });

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-123' },
      data: { name: 'New Name' },
    });
  });

  it('deletes organization data in a transaction before deleting the organization', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    prisma.organization.delete.mockResolvedValue(organization);

    await repository.deleteCascade('org-123');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: [10, 11] } },
    });
    expect(prisma.organization.delete).toHaveBeenCalledWith({
      where: { id: 'org-123' },
    });
  });
});

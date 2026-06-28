import { StoreAreaRepository } from '../../repositories/store-area.repository';

describe('StoreAreaRepository', () => {
  const organizationId = 'org-123';
  const now = new Date('2026-01-01T00:00:00.000Z');

  const storeAreaRecord = {
    id: 1,
    organizationId,
    name: 'Front Counter',
    subDepartment: null,
    lastChecked: now,
    createdAt: now,
    updatedAt: now,
  };

  let prisma: {
    storeArea: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let repository: StoreAreaRepository;

  beforeEach(() => {
    prisma = {
      storeArea: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    repository = new StoreAreaRepository(prisma as never);
  });

  it('finds all store areas for an organization ordered by name', async () => {
    prisma.storeArea.findMany.mockResolvedValue([storeAreaRecord]);

    const results = await repository.findAll(organizationId);

    expect(results).toEqual([storeAreaRecord]);
    expect(prisma.storeArea.findMany).toHaveBeenCalledWith({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  });

  it('finds a store area by id within an organization', async () => {
    prisma.storeArea.findFirst.mockResolvedValue(storeAreaRecord);

    const result = await repository.findById(1, organizationId);

    expect(result).toBe(storeAreaRecord);
    expect(prisma.storeArea.findFirst).toHaveBeenCalledWith({
      where: { id: 1, organizationId },
    });
  });

  it('creates store areas with normalized optional fields', async () => {
    prisma.storeArea.create.mockResolvedValue(storeAreaRecord);

    await repository.create(organizationId, {
      name: 'Front Counter',
      subDepartment: '',
      lastChecked: '2026-01-01',
    });

    expect(prisma.storeArea.create).toHaveBeenCalledWith({
      data: {
        organizationId,
        name: 'Front Counter',
        subDepartment: null,
        lastChecked: new Date('2026-01-01'),
      },
    });
  });

  it('updates only provided store area fields', async () => {
    prisma.storeArea.update.mockResolvedValue(storeAreaRecord);

    await repository.update(1, {
      name: 'Dispensary',
      subDepartment: '',
    });

    expect(prisma.storeArea.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        name: 'Dispensary',
        subDepartment: null,
      },
    });
  });
});

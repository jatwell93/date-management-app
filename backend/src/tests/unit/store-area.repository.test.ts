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
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
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
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: vi.fn(),
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

  it('creates a check cycle after verifying no active cycle exists', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 11,
        organizationId,
        name: 'Morning walk',
        status: 'active',
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await repository.createCheckCycle(organizationId, {
      name: 'Morning walk',
      startedAt: now.toISOString(),
    });

    expect(result.id).toBe(11);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects creating a second active cycle in the same organization', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 10 }]);

    await expect(
      repository.createCheckCycle(organizationId, { name: 'Second walk' }),
    ).rejects.toThrow('Active check cycle already exists');
  });

  it('records a bay check inside a transaction and updates derived lastChecked', async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 11 }])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([
          {
            id: 22,
            organizationId,
            cycleId: 11,
            storeAreaId: 5,
            userId: 7,
            checkedAt: now,
            itemsAddedCount: 2,
            notes: null,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await repository.recordBayCheck(organizationId, 7, {
      storeAreaId: 5,
      checkedAt: now.toISOString(),
      itemsAddedCount: 2,
    });

    expect(result.id).toBe(22);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('builds floor progress with ordered departments and checked bay state', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 11,
          organizationId,
          name: 'Morning walk',
          status: 'active',
          startedAt: now,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: 'Bay 1',
          parentId: 1,
          parentName: 'Dairy',
          lastChecked: now,
        },
        {
          id: 6,
          name: 'Bay 2',
          parentId: 1,
          parentName: 'Dairy',
          lastChecked: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          storeAreaId: 5,
          checkedAt: now,
          userId: 7,
          checkerName: 'Manager',
        },
      ]);

    const result = await repository.getFloorProgress(organizationId);

    expect(result.summary.coveragePercent).toBe(50);
    expect(result.departments[0].department).toEqual({ id: 1, name: 'Dairy' });
    expect(result.departments[0].bays.map((bay) => bay.state)).toEqual(['checked', 'not_checked']);
  });
});

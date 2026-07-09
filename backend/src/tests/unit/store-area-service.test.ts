import { PrismaClient } from '@prisma/client';
import { StoreAreaService } from '../../services/store-area.service';
import { StoreAreaRepository } from '../../repositories/store-area.repository';

describe('StoreAreaService - findUnique fix', () => {
  let prisma: PrismaClient;
  let service: StoreAreaService;
  let org1Id: string;
  let org2Id: string;
  let storeArea1: any;
  let storeArea2: any;

  beforeEach(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./test.db',
        },
      },
    });

    // Create test organizations
    org1Id = 'org-1';
    org2Id = 'org-2';

    try {
      await prisma.organization.create({
        data: { id: org1Id, name: 'Org 1', slug: 'org-1' },
      });
    } catch (e) {
      // Ignore if already exists
    }

    try {
      await prisma.organization.create({
        data: { id: org2Id, name: 'Org 2', slug: 'org-2' },
      });
    } catch (e) {
      // Ignore if already exists
    }

    // Create store areas with same ID in different orgs (simulating potential cross-tenant access)
    storeArea1 = await prisma.storeArea.create({
      data: {
        organizationId: org1Id,
        name: 'Store A',
        subDepartment: 'Dept 1',
      },
    });

    storeArea2 = await prisma.storeArea.create({
      data: {
        organizationId: org2Id,
        name: 'Store B',
        subDepartment: 'Dept 2',
      },
    });

    service = new StoreAreaService(org1Id, prisma);
  });

  afterEach(async () => {
    // Clean up
    await prisma.storeArea.deleteMany({
      where: { organizationId: { in: [org1Id, org2Id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org1Id, org2Id] } },
    });
    await prisma.$disconnect();
  });

  it('should only return store area from own organization', async () => {
    // Try to get storeArea2 while authenticated with org1
    const result = await service.getStoreAreaById(storeArea2.id);
    expect(result).toBeNull(); // Should not find store area from different org
  });

  it('should return store area from own organization', async () => {
    const result = await service.getStoreAreaById(storeArea1.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(storeArea1.id);
    expect(result?.organizationId).toBe(org1Id);
  });

  it('should return null for non-existent ID', async () => {
    const result = await service.getStoreAreaById(99999);
    expect(result).toBeNull();
  });
});

describe('StoreAreaService repository injection', () => {
  const organizationId = 'org-1';
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('uses the injected repository for store area reads', async () => {
    const repository = {
      findAll: vi.fn().mockResolvedValue([
        {
          id: 1,
          organizationId,
          name: 'Front Counter',
          subDepartment: null,
          lastChecked: now,
          createdAt: now,
          updatedAt: now,
        },
      ]),
    } as unknown as StoreAreaRepository;

    const service = new StoreAreaService(organizationId, {} as PrismaClient, repository);

    const results = await service.getAllStoreAreas();

    expect(repository.findAll).toHaveBeenCalledWith(organizationId);
    expect(results).toEqual([
      {
        id: 1,
        organizationId,
        name: 'Front Counter',
        subDepartment: undefined,
        lastChecked: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ]);
  });

  it('creates check cycles through the injected repository', async () => {
    const repository = {
      createCheckCycle: vi.fn().mockResolvedValue({
        id: 11,
        organizationId,
        name: 'Morning walk',
        status: 'active',
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    } as unknown as StoreAreaRepository;

    const service = new StoreAreaService(organizationId, {} as PrismaClient, repository);

    const result = await service.createCheckCycle({ name: 'Morning walk' });

    expect(repository.createCheckCycle).toHaveBeenCalledWith(organizationId, {
      name: 'Morning walk',
      startedAt: undefined,
    });
    expect(result).toEqual({
      id: 11,
      organizationId,
      name: 'Morning walk',
      status: 'active',
      startedAt: now.toISOString(),
      completedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it('passes active-cycle and duplicate-cycle validation errors through unchanged', async () => {
    const duplicate = new Error('Active check cycle already exists');
    const noActiveCycle = new Error('Active check cycle is required');
    const repository = {
      createCheckCycle: vi.fn().mockRejectedValue(duplicate),
      recordBayCheck: vi.fn().mockRejectedValue(noActiveCycle),
    } as unknown as StoreAreaRepository;
    const service = new StoreAreaService(organizationId, {} as PrismaClient, repository);

    await expect(service.createCheckCycle({ name: 'Morning walk' })).rejects.toThrow(
      'Active check cycle already exists',
    );
    await expect(service.recordBayCheck(7, { storeAreaId: 5 })).rejects.toThrow(
      'Active check cycle is required',
    );
  });

  it('rejects bay checks for non-leaf departments through the repository validation', async () => {
    const repository = {
      recordBayCheck: vi.fn().mockRejectedValue(new Error('Bay check must target a leaf bay')),
    } as unknown as StoreAreaRepository;
    const service = new StoreAreaService(organizationId, {} as PrismaClient, repository);

    await expect(service.recordBayCheck(7, { storeAreaId: 1 })).rejects.toThrow(
      'Bay check must target a leaf bay',
    );
  });

  it('returns floor progress grouped by department using repository data', async () => {
    const repository = {
      getFloorProgress: vi.fn().mockResolvedValue({
        activeCycle: {
          id: 11,
          organizationId,
          name: 'Morning walk',
          status: 'active',
          startedAt: now,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        summary: {
          totalBays: 2,
          checkedBays: 1,
          notCheckedBays: 1,
          overdueBays: 0,
          coveragePercent: 50,
          uncheckedBays: 1,
        },
        departments: [
          {
            department: { id: 1, name: 'Dairy' },
            summary: {
              totalBays: 2,
              checkedBays: 1,
              notCheckedBays: 1,
              overdueBays: 0,
              coveragePercent: 50,
              uncheckedBays: 1,
            },
            bays: [
              {
                id: 5,
                name: 'Bay 1',
                parentId: 1,
                state: 'checked',
                checkedAt: now,
                checkedBy: { id: 7, name: 'Manager' },
              },
              {
                id: 6,
                name: 'Bay 2',
                parentId: 1,
                state: 'not_checked',
                checkedAt: null,
                checkedBy: null,
              },
            ],
          },
        ],
      }),
    } as unknown as StoreAreaRepository;
    const service = new StoreAreaService(organizationId, {} as PrismaClient, repository);

    const result = await service.getFloorProgress();

    expect(repository.getFloorProgress).toHaveBeenCalledWith(organizationId);
    expect(result.departments[0].bays).toEqual([
      expect.objectContaining({ id: 5, state: 'checked', checkedAt: now.toISOString() }),
      expect.objectContaining({ id: 6, state: 'not_checked', checkedAt: null }),
    ]);
  });
});

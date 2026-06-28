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
});

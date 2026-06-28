import { checkUsageLimit } from '../../middleware/feature-gate.middleware';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { getDiContainer } from '../../di/container';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { SubscriptionRepository } from '../../repositories/subscription.repository';

vi.mock('../../database/database-factory');
vi.mock('../../di/container', () => ({
  getDiContainer: vi.fn(),
}));

describe('feature-gate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 with creation_locked message for POST when org isCreationLocked=true', async () => {
    const mockPrisma = {
      organizationUsage: {
        upsert: vi.fn().mockResolvedValue({
          organizationId: 'org-123',
          activeUsers: 0,
          maxUsers: 1,
          totalSkus: 600,
          maxSkus: 500,
          storageUsedBytes: 0,
        }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'org-123',
          isCreationLocked: true,
        }),
      },
      subscriptionTier: {
        findFirst: vi.fn(),
      },
    } as any;

    (getDefaultDatabaseClient as jest.Mock).mockReturnValue(mockPrisma);
    (getDiContainer as jest.Mock).mockReturnValue({
      resolve: vi.fn((token) => {
        if (token === SubscriptionRepository) {
          return {
            getOrCreateUsage: mockPrisma.organizationUsage.upsert,
            findLatestByOrganizationId: mockPrisma.subscriptionTier.findFirst,
          };
        }
        if (token === OrganizationRepository) {
          return {
            findCreationLockById: mockPrisma.organization.findUnique,
          };
        }
        throw new Error(`Unexpected token ${String(token)}`);
      }),
    });

    const req = {
      organizationId: 'org-123',
      tierLevel: 'starter',
      userId: 1,
      ip: '127.0.0.1',
      get: vi.fn(),
      headers: {},
      path: '/products',
      method: 'POST',
    } as any;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      locals: {},
    } as any;

    const next = vi.fn();

    await checkUsageLimit('max_skus')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ locked: true }));
    expect(next).not.toHaveBeenCalled();
  });

  it('checks usage limits through repositories instead of the default database client', async () => {
    const subscriptionRepository = {
      getOrCreateUsage: vi.fn().mockResolvedValue({
        organizationId: 'org-123',
        activeUsers: 0,
        maxUsers: 1,
        totalSkus: 100,
        maxSkus: 500,
        totalInventoryItems: 100,
        storageUsedBytes: 0,
      }),
      findLatestByOrganizationId: vi.fn(),
    };
    const organizationRepository = {
      findCreationLockById: vi.fn().mockResolvedValue({ isCreationLocked: false }),
    };

    (getDiContainer as jest.Mock).mockReturnValue({
      resolve: vi.fn((token) => {
        if (token === SubscriptionRepository) return subscriptionRepository;
        if (token === OrganizationRepository) return organizationRepository;
        throw new Error(`Unexpected token ${String(token)}`);
      }),
    });
    (getDefaultDatabaseClient as jest.Mock).mockImplementation(() => {
      throw new Error('default database client should not be used');
    });

    const req = {
      organizationId: 'org-123',
      tierLevel: 'starter',
      userId: 1,
      ip: '127.0.0.1',
      get: vi.fn(),
      headers: {},
      path: '/products',
      method: 'POST',
    } as any;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      locals: {},
    } as any;

    const next = vi.fn();

    await checkUsageLimit('max_skus')(req, res, next);

    expect(subscriptionRepository.getOrCreateUsage).toHaveBeenCalledWith('org-123');
    expect(organizationRepository.findCreationLockById).toHaveBeenCalledWith('org-123');
    expect(getDefaultDatabaseClient).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('allows PUT when org isCreationLocked=true so customers can reduce usage', async () => {
    const mockPrisma = {
      organizationUsage: {
        upsert: vi.fn().mockResolvedValue({
          organizationId: 'org-123',
          activeUsers: 0,
          maxUsers: 1,
          totalSkus: 100,
          maxSkus: 500,
          storageUsedBytes: 0,
        }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'org-123',
          isCreationLocked: true,
        }),
      },
      subscriptionTier: {
        findFirst: vi.fn(),
      },
    } as any;

    (getDefaultDatabaseClient as jest.Mock).mockReturnValue(mockPrisma);
    (getDiContainer as jest.Mock).mockReturnValue({
      resolve: vi.fn((token) => {
        if (token === SubscriptionRepository) {
          return {
            getOrCreateUsage: mockPrisma.organizationUsage.upsert,
            findLatestByOrganizationId: mockPrisma.subscriptionTier.findFirst,
          };
        }
        if (token === OrganizationRepository) {
          return {
            findCreationLockById: mockPrisma.organization.findUnique,
          };
        }
        throw new Error(`Unexpected token ${String(token)}`);
      }),
    });

    const req = {
      organizationId: 'org-123',
      tierLevel: 'starter',
      userId: 1,
      ip: '127.0.0.1',
      get: vi.fn(),
      headers: {},
      path: '/products/1',
      method: 'PUT',
    } as any;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      locals: {},
    } as any;

    const next = vi.fn();

    await checkUsageLimit('max_skus')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

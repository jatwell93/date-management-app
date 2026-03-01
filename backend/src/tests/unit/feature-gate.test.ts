import { checkUsageLimit } from '../../middleware/feature-gate.middleware';
import { getDefaultDatabaseClient } from '../../database/database-factory';

jest.mock('../../database/database-factory');

describe('feature-gate middleware', () => {
  it('returns 403 with creation_locked message when org isCreationLocked=true', async () => {
    const mockPrisma = {
      organizationUsage: {
        upsert: jest.fn().mockResolvedValue({
          organizationId: 'org-123',
          activeUsers: 0,
          maxUsers: 1,
          totalSkus: 600,
          maxSkus: 500,
          storageUsedBytes: 0,
        }),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-123',
          isCreationLocked: true,
        }),
      },
      subscriptionTier: {
        findFirst: jest.fn(),
      },
    } as any;

    (getDefaultDatabaseClient as jest.Mock).mockReturnValue(mockPrisma);

    const req = {
      organizationId: 'org-123',
      tierLevel: 'starter',
      userId: 1,
      ip: '127.0.0.1',
      get: jest.fn(),
      headers: {},
      path: '/products',
      method: 'POST',
    } as any;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      locals: {},
    } as any;

    const next = jest.fn();

    await checkUsageLimit('max_skus')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ locked: true }));
    expect(next).not.toHaveBeenCalled();
  });
});

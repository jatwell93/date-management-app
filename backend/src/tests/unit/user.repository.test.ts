import { UserRepository } from '../../repositories/user.repository';

describe('UserRepository', () => {
  const organizationId = 'org-123';
  const now = new Date('2026-01-01T00:00:00.000Z');
  const user = {
    id: 1,
    organizationId,
    clerkUserId: 'clerk-1',
    email: 'user@example.com',
    username: 'user',
    role: 'member',
    createdAt: now,
    updatedAt: now,
  };

  let prisma: {
    user: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let repository: UserRepository;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    repository = new UserRepository(prisma as never);
  });

  it('finds users for an organization', async () => {
    prisma.user.findMany.mockResolvedValue([user]);

    const result = await repository.findByOrganization(organizationId);

    expect(result).toEqual([user]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { organizationId },
    });
  });

  it('finds a user by id within an organization', async () => {
    prisma.user.findFirst.mockResolvedValue(user);

    const result = await repository.findById(1, organizationId);

    expect(result).toBe(user);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 1, organizationId },
    });
  });

  it('creates a Clerk-backed user record', async () => {
    prisma.user.create.mockResolvedValue(user);

    await repository.createClerkUser({
      organizationId,
      clerkUserId: 'clerk-1',
      email: 'user@example.com',
      username: undefined,
      role: 'member',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        organizationId,
        clerkUserId: 'clerk-1',
        email: 'user@example.com',
        username: null,
        role: 'member',
      },
    });
  });

  it('updates a user role within an organization', async () => {
    prisma.user.update.mockResolvedValue(user);

    await repository.update(1, organizationId, { role: 'admin' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1, organizationId },
      data: { role: 'admin' },
    });
  });
});

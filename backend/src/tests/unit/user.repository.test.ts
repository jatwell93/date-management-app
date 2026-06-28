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
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let repository: UserRepository;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
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

  it('finds a Clerk user with organization subscription data', async () => {
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await repository.findByClerkUserIdWithOrganizationSubscriptions('clerk-1');

    expect(result).toBe(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk-1' },
      include: {
        organization: {
          include: {
            subscriptionTiers: true,
          },
        },
      },
    });
  });

  it('finds a Clerk user organization id', async () => {
    prisma.user.findUnique.mockResolvedValue({ organizationId });

    const result = await repository.findOrganizationIdByClerkUserId('clerk-1');

    expect(result).toEqual({ organizationId });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk-1' },
      select: { organizationId: true },
    });
  });

  it('finds an active Clerk user for authentication', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'member',
      organizationId,
    });

    const result = await repository.findActiveByClerkUserId('clerk-1');

    expect(result).toEqual({
      id: 1,
      role: 'member',
      organizationId,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk-1', deletedAt: null },
      select: {
        id: true,
        role: true,
        organizationId: true,
      },
    });
  });
});

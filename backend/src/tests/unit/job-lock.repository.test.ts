import { JobLockRepository } from '../../repositories/job-lock.repository';

describe('JobLockRepository', () => {
  let prisma: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let repository: JobLockRepository;

  beforeEach(() => {
    prisma = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
    };
    repository = new JobLockRepository(prisma as never);
  });

  it('acquires a lock by inserting a migration lock row', async () => {
    prisma.$executeRaw.mockResolvedValue(1);

    await expect(repository.acquire('daily-metrics-2026-02-10', 10)).resolves.toBe(true);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns false when an active lock already exists', async () => {
    prisma.$executeRaw.mockRejectedValue({ code: 'SQLITE_CONSTRAINT' });
    prisma.$queryRaw.mockResolvedValue([{ appliedAt: new Date('2099-01-01T00:00:00.000Z') }]);

    await expect(repository.acquire('daily-metrics-2026-02-10', 10)).resolves.toBe(false);
  });

  it('releases a lock by deleting the migration lock row', async () => {
    prisma.$executeRaw.mockResolvedValue(1);

    await repository.release('daily-metrics-2026-02-10');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

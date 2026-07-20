import { PrismaClient } from '@prisma/client';
import { OrgAuditService } from '../../services/org-audit.service';

describe('OrgAuditService', () => {
  const organizationId = 'org-123';

  let prisma: {
    orgAuditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      orgAuditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };
  });

  it('delegates emit to the repository when injected', async () => {
    const repository = {
      create: vi.fn(),
    };
    const service = new OrgAuditService(prisma as unknown as PrismaClient, repository as never);

    prisma.orgAuditLog.create.mockRejectedValue(new Error('service should use repository'));

    await service.emit({
      organizationId,
      eventType: 'member.invited',
      metadata: { source: 'unit-test' },
    });

    expect(repository.create).toHaveBeenCalledWith({
      organizationId,
      eventType: 'member.invited',
      metadata: { source: 'unit-test' },
    });
    expect(prisma.orgAuditLog.create).not.toHaveBeenCalled();
  });

  it('delegates emitWithClient to the repository with the provided client', async () => {
    const repository = {
      create: vi.fn(),
    };
    const tx = {
      orgAuditLog: {
        create: vi.fn(),
      },
    };
    const service = new OrgAuditService(prisma as unknown as PrismaClient, repository as never);

    await service.emitWithClient(
      {
        organizationId,
        eventType: 'member.removed',
      },
      tx as never,
    );

    expect(repository.create).toHaveBeenCalledWith(
      {
        organizationId,
        eventType: 'member.removed',
      },
      tx,
    );
  });

  it('delegates organization audit queries to the repository', async () => {
    const repository = {
      findByOrganization: vi.fn().mockResolvedValue([{ id: 1 }]),
    };
    const service = new OrgAuditService(prisma as unknown as PrismaClient, repository as never);

    prisma.orgAuditLog.findMany.mockRejectedValue(new Error('service should use repository'));

    const result = await service.getByOrganization(organizationId, { limit: 10 });

    expect(repository.findByOrganization).toHaveBeenCalledWith(organizationId, { limit: 10 });
    expect(prisma.orgAuditLog.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 1 }]);
  });
});

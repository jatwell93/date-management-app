import { OrgAuditRepository } from '../../repositories/org-audit.repository';

describe('OrgAuditRepository', () => {
  const organizationId = 'org-123';

  let prisma: {
    orgAuditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let repository: OrgAuditRepository;

  beforeEach(() => {
    prisma = {
      orgAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repository = new OrgAuditRepository(prisma as never);
  });

  it('creates audit events with normalized nullable fields and serialized metadata', async () => {
    await repository.create({
      organizationId,
      eventType: 'member.invited',
      actorUserId: 10,
      metadata: { source: 'unit-test' },
    });

    expect(prisma.orgAuditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId,
        eventType: 'member.invited',
        actorUserId: 10,
        actorOrganizationId: null,
        targetUserId: null,
        targetOrganizationId: null,
        oldRole: null,
        newRole: null,
        inviteId: null,
        ipAddress: null,
        metadata: JSON.stringify({ source: 'unit-test' }),
      },
    });
  });

  it('finds organization audit events with filters and pagination defaults', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');

    await repository.findByOrganization(organizationId, {
      eventType: 'member.role.changed',
      from,
      to,
      limit: 25,
      offset: 50,
    });

    expect(prisma.orgAuditLog.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        eventType: 'member.role.changed',
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      skip: 50,
    });
  });
});

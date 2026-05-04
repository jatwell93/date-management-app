import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { AuditEventType } from '../constants/roles';
import type { OrgAuditEntry } from '../services/org-audit.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface OrgAuditQueryOptions {
  eventType?: AuditEventType;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

@injectable()
export class OrgAuditRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(client?: DbClient): DbClient {
    return client ?? this.prisma;
  }

  async create(entry: OrgAuditEntry, client?: DbClient): Promise<void> {
    await this.getClient(client).orgAuditLog.create({
      data: {
        organizationId: entry.organizationId,
        eventType: entry.eventType,
        actorUserId: entry.actorUserId ?? null,
        actorOrganizationId: entry.actorOrganizationId ?? null,
        targetUserId: entry.targetUserId ?? null,
        targetOrganizationId: entry.targetOrganizationId ?? null,
        oldRole: entry.oldRole ?? null,
        newRole: entry.newRole ?? null,
        inviteId: entry.inviteId ?? null,
        ipAddress: entry.ipAddress ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  }

  async findByOrganization(organizationId: string, options?: OrgAuditQueryOptions): Promise<any[]> {
    const where: Record<string, unknown> = { organizationId };

    if (options?.eventType) {
      where.eventType = options.eventType;
    }

    if (options?.from || options?.to) {
      where.createdAt = {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      };
    }

    return this.prisma.orgAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }
}

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { AuditEventType, AUDIT_EVENT_TYPES } from '../constants/roles';

export interface OrgAuditEntry {
  organizationId: string;
  eventType: AuditEventType;
  actorUserId?: number | null;
  actorOrganizationId?: string | null;
  targetUserId?: number | null;
  targetOrganizationId?: string | null;
  oldRole?: string | null;
  newRole?: string | null;
  inviteId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class OrgAuditService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  /**
   * Emit audit event using a specific Prisma client (e.g., from a transaction)
   */
  async emitWithClient(entry: OrgAuditEntry, client: PrismaClient): Promise<void> {
    await client.orgAuditLog.create({
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

  async emit(entry: OrgAuditEntry): Promise<void> {
    await this.prisma.orgAuditLog.create({
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

  async getByOrganization(
    organizationId: string,
    options?: {
      eventType?: AuditEventType;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
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

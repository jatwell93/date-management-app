import { PrismaClient, Prisma } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { AuditEventType } from '../constants/roles';
import { OrgAuditRepository, OrgAuditQueryOptions } from '../repositories/org-audit.repository';

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
  private orgAuditRepo: OrgAuditRepository;

  constructor(prismaClient?: PrismaClient, orgAuditRepo?: OrgAuditRepository) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.orgAuditRepo = orgAuditRepo ?? new OrgAuditRepository(this.prisma);
  }

  /**
   * Emit audit event using a specific Prisma client (e.g., from a transaction)
   */
  async emitWithClient(
    entry: OrgAuditEntry,
    client: PrismaClient | Prisma.TransactionClient,
  ): Promise<void> {
    await this.orgAuditRepo.create(entry, client);
  }

  async emit(entry: OrgAuditEntry): Promise<void> {
    await this.orgAuditRepo.create(entry);
  }

  async getByOrganization(organizationId: string, options?: OrgAuditQueryOptions) {
    return this.orgAuditRepo.findByOrganization(organizationId, options);
  }
}

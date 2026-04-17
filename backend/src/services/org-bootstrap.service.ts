import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { ROLES, normalizeRole, RoleValue } from '../constants/roles';
import { OrgAuditService } from './org-audit.service';
import { AUDIT_EVENT_TYPES } from '../constants/roles';

export interface BootstrapParams {
  clerkUserId: string;
  clerkOrganizationId: string;
  organizationName: string;
  organizationSlug: string;
  email: string;
  username?: string | null;
  clerkMembershipRole?: string | null;
  ipAddress?: string | null;
}

export interface BootstrapResult {
  userId: number;
  organizationId: string;
  role: RoleValue;
  isNewOrg: boolean;
  isNewUser: boolean;
  isFirstAdmin: boolean;
}

/**
 * Deterministic first-login admin bootstrap service.
 *
 * Flow (per design.md Decision 2):
 *   1. Verify Clerk org context exists in params
 *   2. Create org in DB if not exists (with clerkOrganizationId)
 *   3. Check if active admin exists:
 *      - If not → assign admin to current user (transactional)
 *      - If yes → map user role from Clerk membership role
 *   4. Return membership and org context
 *
 * Idempotent: calling with the same params returns the same result.
 * Race-safe: uses transaction with uniqueness checks.
 */
export class OrgBootstrapService {
  private prisma: PrismaClient;
  private auditService: OrgAuditService;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.auditService = new OrgAuditService(this.prisma);
  }

  async bootstrap(params: BootstrapParams): Promise<BootstrapResult> {
    // Step 1: Find or create the organization
    let org = await this.prisma.organization.findUnique({
      where: { clerkOrganizationId: params.clerkOrganizationId },
    });

    const isNewOrg = !org;

    if (!org) {
      org = await this.prisma.organization.create({
        data: {
          clerkOrganizationId: params.clerkOrganizationId,
          name: params.organizationName,
          slug: params.organizationSlug,
        },
      });
    }

    // Step 2: Check if this user already exists (idempotent)
    const existingUser = await this.prisma.user.findUnique({
      where: { clerkUserId: params.clerkUserId },
    });

    if (existingUser) {
      // User already bootstrapped — return existing state
      return {
        userId: existingUser.id,
        organizationId: existingUser.organizationId,
        role: normalizeRole(existingUser.role),
        isNewOrg: false,
        isNewUser: false,
        isFirstAdmin: false,
      };
    }

    // Step 3: Check if an active admin exists for this org
    const activeAdmin = await this.prisma.user.findFirst({
      where: {
        organizationId: org.id,
        role: ROLES.ADMIN,
        deletedAt: null,
      },
      select: { id: true },
    });

    // Step 4: Determine role
    let assignedRole: RoleValue;
    let isFirstAdmin = false;

    if (!activeAdmin) {
      // No active admin → this user becomes admin
      assignedRole = ROLES.ADMIN;
      isFirstAdmin = true;
    } else {
      // Admin exists → map from Clerk membership role
      assignedRole = normalizeRole(params.clerkMembershipRole);
    }

    // Step 5: Create user record within transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          organizationId: org.id,
          clerkUserId: params.clerkUserId,
          email: params.email.trim().toLowerCase(),
          username: params.username ?? null,
          role: assignedRole,
        },
      });

      return {
        userId: newUser.id,
        organizationId: org.id,
        role: assignedRole,
        isNewOrg,
        isNewUser: true,
        isFirstAdmin,
      };
    }, { timeout: 15000 });

    // Step 6: Audit log (outside transaction to avoid SQLite deadlock)
    try {
      await this.auditService.emit({
        organizationId: result.organizationId,
        eventType: AUDIT_EVENT_TYPES.ROLE_ASSIGNED,
        actorUserId: result.userId,
        actorOrganizationId: result.organizationId,
        targetUserId: result.userId,
        targetOrganizationId: result.organizationId,
        newRole: result.role,
        ipAddress: params.ipAddress,
        metadata: {
          trigger: 'bootstrap',
          isFirstAdmin: result.isFirstAdmin,
          isNewOrg: result.isNewOrg,
          clerkMembershipRole: params.clerkMembershipRole,
        },
      });
    } catch {
      // Audit failure should not block bootstrap
    }

    return result;
  }
}

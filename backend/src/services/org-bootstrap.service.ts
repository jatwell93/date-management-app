import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { ROLES, normalizeRole, RoleValue } from '../constants/roles';
import { OrgAuditService } from './org-audit.service';
import { AUDIT_EVENT_TYPES } from '../constants/roles';
import { OrganizationRepository } from '../repositories/organization.repository';
import { UserRepository } from '../repositories/user.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { SubscriptionService } from './subscription.service';
import { Logger } from '../utils/logger';

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
  private orgRepo: OrganizationRepository;
  private userRepo: UserRepository;
  private subscriptionService: Pick<SubscriptionService, 'createTrialSubscription'>;
  private subscriptionRepo: SubscriptionRepository;

  constructor(
    prismaClient?: PrismaClient,
    userRepo?: UserRepository,
    subscriptionService?: Pick<SubscriptionService, 'createTrialSubscription'>,
    subscriptionRepo?: SubscriptionRepository,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.auditService = new OrgAuditService(this.prisma);
    this.orgRepo = new OrganizationRepository(this.prisma);
    this.userRepo = userRepo ?? new UserRepository(this.prisma);
    this.subscriptionService = subscriptionService ?? new SubscriptionService(this.prisma);
    this.subscriptionRepo = subscriptionRepo ?? new SubscriptionRepository(this.prisma);
  }

  async bootstrap(params: BootstrapParams): Promise<BootstrapResult> {
    // Step 1: Find or create the organization
    let org = await this.orgRepo.findByClerkOrganizationId(params.clerkOrganizationId);

    const isNewOrg = !org;

    if (!org) {
      org = await this.orgRepo.create({
        clerkOrganizationId: params.clerkOrganizationId,
        name: params.organizationName,
        slug: params.organizationSlug,
      });
    }

    // Step 2: Check if this user already exists (idempotent)
    const existingUser = await this.userRepo.findUniqueByClerkUserId(params.clerkUserId);

    if (existingUser) {
      const organizationId = existingUser.organizationId ?? org.id;
      await this.ensureTrialSubscription(organizationId);

      return {
        userId: existingUser.id,
        organizationId,
        role: existingUser.role as RoleValue,
        isNewOrg,
        isNewUser: false,
        isFirstAdmin: false,
      };
    }

    // Step 3: Check if an active admin exists for this org
    const activeAdmin = await this.userRepo.findAdminByOrganizationId(org.id);

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
    const result = await this.prisma.$transaction(
      async (tx) => {
        const newUser = await this.userRepo.createClerkUser(
          {
            organizationId: org.id,
            clerkUserId: params.clerkUserId,
            email: params.email.trim().toLowerCase(),
            username: params.username ?? null,
            role: assignedRole,
          },
          tx,
        );

        return {
          userId: newUser.id,
          organizationId: org.id,
          role: assignedRole,
          isNewOrg,
          isNewUser: true,
          isFirstAdmin,
        };
      },
      { timeout: 15000 },
    );

    await this.emitBootstrapAudit(result, params);
    await this.ensureTrialSubscription(result.organizationId);

    return result;
  }

  private async emitBootstrapAudit(
    result: BootstrapResult,
    params: BootstrapParams,
  ): Promise<void> {
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
  }

  private async ensureTrialSubscription(organizationId: string): Promise<void> {
    const existingSubscription = await this.subscriptionRepo.findByOrganizationId(organizationId);

    if (existingSubscription) {
      return;
    }

    try {
      await this.subscriptionService.createTrialSubscription(organizationId, 14);
    } catch (error) {
      const alreadyCreated = await this.subscriptionRepo.findByOrganizationId(organizationId);
      if (alreadyCreated) {
        Logger.info(
          `Trial subscription already exists for organization ${organizationId} (concurrent creation)`,
        );
        return;
      }
      throw error;
    }
  }
}

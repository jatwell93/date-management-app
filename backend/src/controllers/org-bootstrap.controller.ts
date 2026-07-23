import { Response } from 'express';
import { isPlatformAdminUser } from '../../../shared/domain/platform-catalogue';
import { isBaseError } from '../errors';
import { AuthRequest } from '../middleware/auth.middleware';
import { ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { OrgBootstrapService } from '../services/org-bootstrap.service';
import { SeedService } from '../services/seed.service';
import { Logger } from '../utils/logger';

export class OrgBootstrapController {
  constructor(
    private bootstrapService: Pick<OrgBootstrapService, 'bootstrap'>,
    private seedService: Pick<SeedService, 'seedDemoData'>,
    private now: () => number = Date.now,
  ) {}

  async bootstrap(req: ClerkAuthRequest, res: Response): Promise<void> {
    try {
      if (!req.auth?.userId || !req.auth.email) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const { organizationName, organizationSlug, clerkOrganizationId, clerkMembershipRole } =
        req.body;
      const timestamp = this.now();
      const emailPrefix = req.auth.email.split('@')[0];
      const finalClerkOrgId = clerkOrganizationId || `clerk-org-${req.auth.userId}-${timestamp}`;
      const finalOrgName = organizationName || `${emailPrefix}'s Organization`;
      const finalOrgSlug =
        organizationSlug || `${emailPrefix}-${timestamp}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      const result = await this.bootstrapService.bootstrap({
        clerkUserId: req.auth.userId,
        clerkOrganizationId: finalClerkOrgId,
        organizationName: finalOrgName,
        organizationSlug: finalOrgSlug,
        email: req.auth.email,
        username: req.auth.username ?? null,
        clerkMembershipRole: clerkMembershipRole ?? null,
        ipAddress: req.ip ?? null,
      });

      res.status(result.isNewUser ? 201 : 200).json({
        userId: result.userId,
        organizationId: result.organizationId,
        role: result.role,
        isNewOrg: result.isNewOrg,
        isNewUser: result.isNewUser,
        isFirstAdmin: result.isFirstAdmin,
        isPlatformAdmin: isPlatformAdminUser(result.userId, process.env.PLATFORM_ADMIN_USER_IDS),
      });
    } catch (error) {
      this.handleError(error, res, 'Bootstrap failed');
    }
  }

  async seedDemoData(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.organizationId) {
        res.status(400).json({ message: 'Organization context missing' });
        return;
      }

      const result = await this.seedService.seedDemoData(req.organizationId);
      res.status(200).json(result);
    } catch (error) {
      this.handleError(error, res, 'Seeding failed');
    }
  }

  private handleError(error: unknown, res: Response, message: string): void {
    if (isBaseError(error)) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
      return;
    }

    Logger.error(`[org-bootstrap] ${message}`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ message: 'Internal server error' });
  }
}

export function createOrgBootstrapController(): OrgBootstrapController {
  return new OrgBootstrapController(new OrgBootstrapService(), new SeedService());
}

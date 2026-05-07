import { Router, Response, RequestHandler } from 'express';
import { clerkAuth, ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { authenticateToken, AuthRequest, requireManager } from '../middleware/auth.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { organizationBootstrapSchema } from '../schemas';
import { OrgBootstrapService } from '../services/org-bootstrap.service';
import { SeedService } from '../services/seed.service';
import { isBaseError } from '../errors';

const router = Router();
const bootstrapService = new OrgBootstrapService();
const seedService = new SeedService();
const clerkAuthHandler: RequestHandler = (req, res, next) =>
  clerkAuth(req as ClerkAuthRequest, res, next);
const authenticateTokenHandler: RequestHandler = (req, res, next) =>
  authenticateToken(req as AuthRequest, res, next);
const requireManagerHandler: RequestHandler = (req, res, next) =>
  requireManager(req as AuthRequest, res, next);

/**
 * POST /api/organization/bootstrap
 *
 * Called after Clerk authentication + org creation during onboarding.
 * Creates the DB organization + user record, assigns admin if first user.
 * Idempotent — safe to retry.
 *
 * Requires: Clerk JWT (via clerkAuth middleware)
 * Body: { organizationName, organizationSlug, clerkOrganizationId, clerkMembershipRole? }
 */
router.post(
  '/bootstrap',
  clerkAuthHandler,
  standardLimiter,
  validateRequest(organizationBootstrapSchema),
  async (req, res: Response) => {
    try {
      const clerkReq = req as ClerkAuthRequest;

      if (!clerkReq.auth?.userId || !clerkReq.auth.email) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const { organizationName, organizationSlug, clerkOrganizationId, clerkMembershipRole } =
        clerkReq.body;

      // If no clerkOrganizationId provided, generate a default one
      // This allows bootstrap to work for users without explicit Clerk org context
      const finalClerkOrgId =
        clerkOrganizationId || `clerk-org-${clerkReq.auth.userId}-${Date.now()}`;
      const finalOrgName =
        organizationName || `${clerkReq.auth.email.split('@')[0]}'s Organization`;
      const finalOrgSlug =
        organizationSlug ||
        `${clerkReq.auth.email.split('@')[0]}-${Date.now()}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-');

      const result = await bootstrapService.bootstrap({
        clerkUserId: clerkReq.auth.userId,
        clerkOrganizationId: finalClerkOrgId,
        organizationName: finalOrgName,
        organizationSlug: finalOrgSlug,
        email: clerkReq.auth.email,
        username: clerkReq.auth.username ?? null,
        clerkMembershipRole: clerkMembershipRole ?? null,
        ipAddress: clerkReq.ip ?? null,
      });

      return res.status(result.isNewUser ? 201 : 200).json({
        userId: result.userId,
        organizationId: result.organizationId,
        role: result.role,
        isNewOrg: result.isNewOrg,
        isNewUser: result.isNewUser,
        isFirstAdmin: result.isFirstAdmin,
      });
    } catch (error) {
      if (isBaseError(error)) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }

      console.error('[org-bootstrap] Bootstrap failed:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },
);

/**
 * POST /api/organization/seed-demo-data
 *
 * Seeds the organization with sample products and store areas.
 * Used during onboarding for a "Load Demo Data" experience.
 *
 * Requires: Valid session token (via authenticateToken) + Admin/Manager role
 */
router.post(
  '/seed-demo-data',
  authenticateTokenHandler,
  requireManagerHandler,
  standardLimiter,
  async (req, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const organizationId = authReq.organizationId;

      if (!organizationId) {
        return res.status(400).json({ message: 'Organization context missing' });
      }

      const result = await seedService.seedDemoData(organizationId);

      return res.status(200).json(result);
    } catch (error) {
      if (isBaseError(error)) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }

      console.error('[org-bootstrap] Seeding failed:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },
);

export default router;

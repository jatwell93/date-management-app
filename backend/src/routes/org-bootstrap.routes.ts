import { Router, Response, RequestHandler } from 'express';
import { clerkAuth, ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { organizationBootstrapSchema } from '../schemas';
import { OrgBootstrapService } from '../services/org-bootstrap.service';
import { isBaseError } from '../errors';

const router = Router();
const bootstrapService = new OrgBootstrapService();
const clerkAuthHandler: RequestHandler = (req, res, next) =>
  clerkAuth(req as ClerkAuthRequest, res, next);

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

export default router;

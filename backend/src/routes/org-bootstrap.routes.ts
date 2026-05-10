import { Router, Response, RequestHandler } from 'express';
import { clerkAuth, ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { authenticateToken, AuthRequest, requireManager } from '../middleware/auth.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { organizationBootstrapSchema } from '../schemas';
import { createOrgBootstrapController } from '../controllers/org-bootstrap.controller';

const router = Router();
const orgBootstrapController = createOrgBootstrapController();
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
  (req, res: Response) => orgBootstrapController.bootstrap(req as ClerkAuthRequest, res),
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
  (req, res: Response) => orgBootstrapController.seedDemoData(req as AuthRequest, res),
);

export default router;

import { Router, RequestHandler } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/requireOrgRole';
import { clerkAuth, ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { organizationInviteAcceptSchema, organizationInviteCreateSchema } from '../schemas';
import { envConfig } from '../config/environment';
import { createOrganizationInviteController } from '../controllers/organization-invite.controller';

const router = Router();
const controller = createOrganizationInviteController();

const clerkAuthHandler: RequestHandler = (req, res, next) =>
  clerkAuth(req as ClerkAuthRequest, res, next);
const requireCustomInviteRoutesEnabled: RequestHandler = (_req, res, next) => {
  if (!envConfig.ENABLE_CUSTOM_ORG_INVITES) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Endpoint not found' });
  }

  return next();
};

router.post(
  '/invites',
  requireCustomInviteRoutesEnabled,
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  standardLimiter,
  validateRequest(organizationInviteCreateSchema),
  (req: AuthRequest, res, next) => controller.createInvite(req, res, next),
);

router.post(
  '/invites/accept',
  requireCustomInviteRoutesEnabled,
  clerkAuthHandler,
  standardLimiter,
  validateRequest(organizationInviteAcceptSchema),
  (req, res, next) => controller.acceptInvite(req as ClerkAuthRequest, res, next),
);

router.get(
  '/invites',
  requireCustomInviteRoutesEnabled,
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  (req: AuthRequest, res, next) => controller.listInvites(req, res, next),
);

router.delete(
  '/invites/:inviteId',
  requireCustomInviteRoutesEnabled,
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  (req: AuthRequest, res, next) => controller.revokeInvite(req, res, next),
);

router.post(
  '/invites/:inviteId/resend',
  requireCustomInviteRoutesEnabled,
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  standardLimiter,
  (req: AuthRequest, res, next) => controller.resendInvite(req, res, next),
);

router.delete(
  '/',
  authenticateToken,
  requireOrgRole('admin'),
  (req: AuthRequest, res, next) => controller.deleteOrganization(req, res, next),
);

export default router;

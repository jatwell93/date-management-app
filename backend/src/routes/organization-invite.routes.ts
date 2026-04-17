import { Router, Response, RequestHandler } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/requireOrgRole';
import { clerkAuth, ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { organizationInviteAcceptSchema, organizationInviteCreateSchema } from '../schemas';
import { OrganizationInviteService } from '../services/organization-invite.service';
import { OrganizationService } from '../services/organization.service';
import { EmailService } from '../services/email.service';
import { envConfig } from '../config/environment';
import { isBaseError } from '../errors';
import { RoleValue } from '../constants/roles';

const router = Router();
const inviteService = new OrganizationInviteService();
const organizationService = new OrganizationService();
const emailService = new EmailService();
const clerkAuthHandler: RequestHandler = (req, res, next) =>
  clerkAuth(req as ClerkAuthRequest, res, next);

router.post(
  '/invites',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  standardLimiter,
  validateRequest(organizationInviteCreateSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.organizationId || !req.userId) {
        return res.status(401).json({ message: 'Access denied: Missing organization context' });
      }

      const invite = await inviteService.createInvite({
        organizationId: req.organizationId,
        invitedByUserId: req.userId,
        email: req.body.email as string,
        role: req.body.role as RoleValue,
      });

      const organization = await organizationService.getOrganization(req.organizationId);
      if (!organization) {
        return res.status(404).json({ message: 'Organization not found' });
      }
      const organizationName = organization.name;
      const baseUrl = envConfig.FRONTEND_URL || 'http://localhost:3000';
      const inviteUrl = `${baseUrl}/invites/accept?token=${invite.token}`;

      await emailService.sendOrganizationInviteEmail({
        organizationId: req.organizationId,
        toEmail: invite.email,
        organizationName,
        inviteUrl,
        invitedByUserId: req.userId,
      });

      return res.status(201).json(invite);
    } catch (error) {
      if (isBaseError(error)) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }

      return res.status(500).json({ message: 'Internal server error' });
    }
  },
);

router.post(
  '/invites/accept',
  clerkAuthHandler,
  standardLimiter,
  validateRequest(organizationInviteAcceptSchema),
  async (req, res: Response) => {
    try {
      const clerkReq = req as ClerkAuthRequest;
      if (!clerkReq.auth?.userId || !clerkReq.auth.email) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const result = await inviteService.acceptInvite({
        token: clerkReq.body.token as string,
        clerkUserId: clerkReq.auth.userId,
        email: clerkReq.auth.email,
        username: clerkReq.auth.username ?? null,
      });

      return res.status(200).json({
        status: result.invite.status,
        organizationId: result.invite.organizationId,
      });
    } catch (error) {
      if (isBaseError(error)) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }

      return res.status(500).json({ message: 'Internal server error' });
    }
  },
);

router.get('/invites', authenticateToken, requireOrgRole('admin', 'manager'), async (req: AuthRequest, res) => {
  try {
    if (!req.organizationId) {
      return res.status(401).json({ message: 'Access denied: Missing organization context' });
    }

    const invites = await inviteService.listPendingInvites(req.organizationId);
    return res.json(invites);
  } catch (error) {
    if (isBaseError(error)) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete(
  '/invites/:inviteId',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.organizationId) {
        return res.status(401).json({ message: 'Access denied: Missing organization context' });
      }

      const invite = await inviteService.revokeInvite(req.organizationId, req.params.inviteId, req.userId);
      return res.json(invite);
    } catch (error) {
      if (isBaseError(error)) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }

      return res.status(500).json({ message: 'Internal server error' });
    }
  },
);

router.post(
  '/invites/:inviteId/resend',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  standardLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.organizationId || !req.userId) {
        return res.status(401).json({ message: 'Access denied: Missing organization context' });
      }

      const updated = await inviteService.resendInvite(req.organizationId, req.params.inviteId, req.userId);

      const organization = await organizationService.getOrganization(req.organizationId);
      if (!organization) {
        return res.status(404).json({ message: 'Organization not found' });
      }

      const baseUrl = envConfig.FRONTEND_URL || 'http://localhost:3000';
      const inviteUrl = `${baseUrl}/invites/accept?token=${updated.token}`;

      await emailService.sendOrganizationInviteEmail({
        organizationId: req.organizationId,
        toEmail: updated.email,
        organizationName: organization.name,
        inviteUrl,
        invitedByUserId: req.userId,
      });

      return res.status(200).json({ message: 'Invite resent', inviteId: updated.id });
    } catch (error) {
      if (isBaseError(error)) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }

      return res.status(500).json({ message: 'Internal server error' });
    }
  },
);

router.delete('/', authenticateToken, requireOrgRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.organizationId) {
      return res.status(401).json({ message: 'Access denied: Missing organization context' });
    }

    const deleted = await organizationService.deleteOrganization(req.organizationId);
    if (!deleted) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    return res.status(200).json({ message: 'Organization deleted successfully' });
  } catch (error) {
    if (isBaseError(error)) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;

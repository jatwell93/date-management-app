import { Response, NextFunction } from 'express';
import { injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { OrganizationInviteService } from '../services/organization-invite.service';
import { OrganizationService } from '../services/organization.service';
import { EmailService } from '../services/email.service';
import { envConfig } from '../config/environment';
import { isBaseError } from '../errors';
import { RoleValue } from '../constants/roles';

@injectable()
export class OrganizationInviteController {
  private inviteService: OrganizationInviteService;
  private organizationService: OrganizationService;
  private emailService: EmailService;

  constructor(
    inviteService?: OrganizationInviteService,
    organizationService?: OrganizationService,
    emailService?: EmailService,
  ) {
    this.inviteService = inviteService ?? new OrganizationInviteService();
    this.organizationService = organizationService ?? new OrganizationService();
    this.emailService = emailService ?? new EmailService();
  }

  async createInvite(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    try {
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ message: 'Access denied: Missing organization context' });
        return;
      }

      const invite = await this.inviteService.createInvite({
        organizationId: req.organizationId,
        invitedByUserId: req.userId,
        email: req.body.email as string,
        role: req.body.role as RoleValue,
      });

      const organization = await this.organizationService.getOrganization(req.organizationId);
      if (!organization) {
        res.status(404).json({ message: 'Organization not found' });
        return;
      }
      const organizationName = organization.name;
      const baseUrl = envConfig.FRONTEND_URL || 'http://localhost:3000';
      const inviteUrl = `${baseUrl}/invites/accept?token=${invite.token}`;

      await this.emailService.sendOrganizationInviteEmail({
        organizationId: req.organizationId,
        toEmail: invite.email,
        organizationName,
        inviteUrl,
        invitedByUserId: req.userId,
      });

      res.status(201).json(invite);
    } catch (error) {
      if (isBaseError(error)) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
        return;
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async acceptInvite(req: ClerkAuthRequest, res: Response, _next: NextFunction): Promise<void> {
    try {
      if (!req.auth?.userId || !req.auth.email) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const result = await this.inviteService.acceptInvite({
        token: req.body.token as string,
        clerkUserId: req.auth.userId,
        email: req.auth.email,
        username: req.auth.username ?? null,
      });

      res.status(200).json({
        status: result.invite.status,
        organizationId: result.invite.organizationId,
      });
    } catch (error) {
      if (isBaseError(error)) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
        return;
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async listInvites(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    try {
      if (!req.organizationId) {
        res.status(401).json({ message: 'Access denied: Missing organization context' });
        return;
      }

      const invites = await this.inviteService.listPendingInvites(req.organizationId);
      res.json(invites);
    } catch (error) {
      if (isBaseError(error)) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
        return;
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async revokeInvite(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    try {
      if (!req.organizationId) {
        res.status(401).json({ message: 'Access denied: Missing organization context' });
        return;
      }

      const invite = await this.inviteService.revokeInvite(
        req.organizationId,
        req.params.inviteId,
        req.userId,
      );
      res.json(invite);
    } catch (error) {
      if (isBaseError(error)) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
        return;
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async resendInvite(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    try {
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ message: 'Access denied: Missing organization context' });
        return;
      }

      const updated = await this.inviteService.resendInvite(
        req.organizationId,
        req.params.inviteId,
        req.userId,
      );

      const organization = await this.organizationService.getOrganization(req.organizationId);
      if (!organization) {
        res.status(404).json({ message: 'Organization not found' });
        return;
      }

      const baseUrl = envConfig.FRONTEND_URL || 'http://localhost:3000';
      const inviteUrl = `${baseUrl}/invites/accept?token=${updated.token}`;

      await this.emailService.sendOrganizationInviteEmail({
        organizationId: req.organizationId,
        toEmail: updated.email,
        organizationName: organization.name,
        inviteUrl,
        invitedByUserId: req.userId,
      });

      res.status(200).json({ message: 'Invite resent', inviteId: updated.id });
    } catch (error) {
      if (isBaseError(error)) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
        return;
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async deleteOrganization(req: AuthRequest, res: Response, _next: NextFunction): Promise<void> {
    try {
      if (!req.organizationId) {
        res.status(401).json({ message: 'Access denied: Missing organization context' });
        return;
      }

      const deleted = await this.organizationService.deleteOrganization(req.organizationId);
      if (!deleted) {
        res.status(404).json({ message: 'Organization not found' });
        return;
      }

      res.status(200).json({ message: 'Organization deleted successfully' });
    } catch (error) {
      if (isBaseError(error)) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
        return;
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

export function createOrganizationInviteController(): OrganizationInviteController {
  return new OrganizationInviteController();
}

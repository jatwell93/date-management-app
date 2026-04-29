import express from 'express';
import request from 'supertest';
import { NotFoundError, ValidationError } from '../../errors';

const mockCreateInvite = jest.fn();
const mockAcceptInvite = jest.fn();
const mockListPendingInvites = jest.fn();
const mockRevokeInvite = jest.fn();
const mockGetOrganization = jest.fn();
const mockDeleteOrganization = jest.fn();
const mockSendOrganizationInviteEmail = jest.fn();

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || undefined;
    const userIdHeader = req.get('x-user-id');
    req.userId = userIdHeader ? Number(userIdHeader) : undefined;
    next();
  },
}));

jest.mock('../../middleware/requireOrgRole', () => ({
  requireOrgRole:
    (...allowedRoles: string[]) =>
    (req: any, _res: any, next: any) => {
      // Mock the role check - always pass for tests
      req.userRole = allowedRoles[0] || 'admin';
      next();
    },
}));

jest.mock('../../middleware/clerk-auth.middleware', () => ({
  clerkAuth: (req: any, _res: any, next: any) => {
    const userId = req.get('x-clerk-user-id');
    const email = req.get('x-clerk-email');
    const username = req.get('x-clerk-username');

    if (userId || email || username) {
      req.auth = {
        userId,
        email,
        username,
      };
    }

    next();
  },
}));

jest.mock('../../middleware/rateLimiter', () => ({
  standardLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/validateRequest', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../services/organization-invite.service', () => ({
  OrganizationInviteService: jest.fn().mockImplementation(() => ({
    createInvite: (...args: unknown[]) => mockCreateInvite(...args),
    acceptInvite: (...args: unknown[]) => mockAcceptInvite(...args),
    listPendingInvites: (...args: unknown[]) => mockListPendingInvites(...args),
    revokeInvite: (...args: unknown[]) => mockRevokeInvite(...args),
  })),
}));

jest.mock('../../services/organization.service', () => ({
  OrganizationService: jest.fn().mockImplementation(() => ({
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
    deleteOrganization: (...args: unknown[]) => mockDeleteOrganization(...args),
  })),
}));

jest.mock('../../services/email.service', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendOrganizationInviteEmail: (...args: unknown[]) => mockSendOrganizationInviteEmail(...args),
  })),
}));

jest.mock('../../config/environment', () => ({
  envConfig: {
    FRONTEND_URL: 'https://app.test.local',
    ENABLE_CUSTOM_ORG_INVITES: true,
  },
}));

import organizationInviteRouter from '../../routes/organization-invite.routes';

describe('organization-invite.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/organization', organizationInviteRouter);

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreateInvite.mockResolvedValue({
      id: 'invite-1',
      organizationId: 'org-1',
      email: 'teammate@example.com',
      role: 'team_member',
      token: 'token-123',
      status: 'PENDING',
    });

    mockGetOrganization.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Pharmacy',
      slug: 'acme-pharmacy',
    });

    mockSendOrganizationInviteEmail.mockResolvedValue(undefined);

    mockAcceptInvite.mockResolvedValue({
      invite: {
        status: 'ACCEPTED',
        organizationId: 'org-1',
      },
    });

    mockListPendingInvites.mockResolvedValue([{ id: 'invite-1', email: 'teammate@example.com' }]);

    mockRevokeInvite.mockResolvedValue({
      id: 'invite-1',
      status: 'REVOKED',
    });

    mockDeleteOrganization.mockResolvedValue(true);
  });

  describe('POST /organization/invites', () => {
    it('creates an invite and sends invite email when request context is valid', async () => {
      const response = await request(app)
        .post('/organization/invites')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '42')
        .send({ email: 'teammate@example.com', role: 'team_member' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: 'invite-1',
          token: 'token-123',
          email: 'teammate@example.com',
        }),
      );

      expect(mockCreateInvite).toHaveBeenCalledWith({
        organizationId: 'org-1',
        invitedByUserId: 42,
        email: 'teammate@example.com',
        role: 'team_member',
      });

      expect(mockSendOrganizationInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          toEmail: 'teammate@example.com',
          organizationName: 'Acme Pharmacy',
          inviteUrl: 'https://app.test.local/invites/accept?token=token-123',
          invitedByUserId: 42,
        }),
      );
    });

    it('returns 401 when organization context is missing', async () => {
      const response = await request(app)
        .post('/organization/invites')
        .set('x-user-id', '42')
        .send({ email: 'teammate@example.com', role: 'team_member' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: Missing organization context' });
      expect(mockCreateInvite).not.toHaveBeenCalled();
    });

    it('returns 404 when organization cannot be loaded', async () => {
      mockGetOrganization.mockResolvedValue(null);

      const response = await request(app)
        .post('/organization/invites')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '42')
        .send({ email: 'teammate@example.com', role: 'team_member' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Organization not found' });
      expect(mockSendOrganizationInviteEmail).not.toHaveBeenCalled();
    });

    it('maps known base errors to status code and error code payload', async () => {
      mockCreateInvite.mockRejectedValue(new ValidationError('Invite role invalid'));

      const response = await request(app)
        .post('/organization/invites')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '42')
        .send({ email: 'teammate@example.com', role: 'owner' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Invite role invalid',
        code: 'VALIDATION_ERROR',
      });
    });

    it('returns 500 for unexpected invite creation failures', async () => {
      mockCreateInvite.mockRejectedValue(new Error('invite subsystem unavailable'));

      const response = await request(app)
        .post('/organization/invites')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '42')
        .send({ email: 'teammate@example.com', role: 'team_member' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('POST /organization/invites/accept', () => {
    it('returns 401 when Clerk auth context is missing', async () => {
      const response = await request(app)
        .post('/organization/invites/accept')
        .send({ token: 'token-123' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Authentication required' });
      expect(mockAcceptInvite).not.toHaveBeenCalled();
    });

    it('accepts invite for authenticated Clerk user', async () => {
      const response = await request(app)
        .post('/organization/invites/accept')
        .set('x-clerk-user-id', 'user_123')
        .set('x-clerk-email', 'teammate@example.com')
        .set('x-clerk-username', 'teammate')
        .send({ token: 'token-123' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ACCEPTED', organizationId: 'org-1' });
      expect(mockAcceptInvite).toHaveBeenCalledWith({
        token: 'token-123',
        clerkUserId: 'user_123',
        email: 'teammate@example.com',
        username: 'teammate',
      });
    });

    it('maps known accept errors to structured error response', async () => {
      mockAcceptInvite.mockRejectedValue(new NotFoundError('Invite not found'));

      const response = await request(app)
        .post('/organization/invites/accept')
        .set('x-clerk-user-id', 'user_123')
        .set('x-clerk-email', 'teammate@example.com')
        .send({ token: 'token-123' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        message: 'Invite not found',
        code: 'NOT_FOUND_ERROR',
      });
    });

    it('returns 500 for unexpected invite acceptance failures', async () => {
      mockAcceptInvite.mockRejectedValue(new Error('accept flow failed'));

      const response = await request(app)
        .post('/organization/invites/accept')
        .set('x-clerk-user-id', 'user_123')
        .set('x-clerk-email', 'teammate@example.com')
        .send({ token: 'token-123' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /organization/invites', () => {
    it('returns 401 when organization context is missing', async () => {
      const response = await request(app).get('/organization/invites');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: Missing organization context' });
      expect(mockListPendingInvites).not.toHaveBeenCalled();
    });

    it('returns pending invites for the requester organization', async () => {
      const response = await request(app).get('/organization/invites').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 'invite-1', email: 'teammate@example.com' }]);
      expect(mockListPendingInvites).toHaveBeenCalledWith('org-1');
    });

    it('returns 500 for unexpected pending-invite lookup failures', async () => {
      mockListPendingInvites.mockRejectedValue(new Error('pending invite query failed'));

      const response = await request(app).get('/organization/invites').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });

    it('maps known pending-invite errors to structured error response', async () => {
      mockListPendingInvites.mockRejectedValue(new ValidationError('Invite list unavailable'));

      const response = await request(app).get('/organization/invites').set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Invite list unavailable',
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('DELETE /organization/invites/:inviteId', () => {
    it('returns 401 when revoke is requested without organization context', async () => {
      const response = await request(app).delete('/organization/invites/invite-1');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: Missing organization context' });
      expect(mockRevokeInvite).not.toHaveBeenCalled();
    });

    it('revokes invite for a valid organization context', async () => {
      const response = await request(app)
        .delete('/organization/invites/invite-1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '42');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: 'invite-1', status: 'REVOKED' });
      expect(mockRevokeInvite).toHaveBeenCalledWith('org-1', 'invite-1', 42);
    });

    it('maps known revoke errors to structured error response', async () => {
      mockRevokeInvite.mockRejectedValue(
        new ValidationError('Only pending invites can be revoked'),
      );

      const response = await request(app)
        .delete('/organization/invites/invite-1')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Only pending invites can be revoked',
        code: 'VALIDATION_ERROR',
      });
    });

    it('returns 500 for unexpected revoke failures', async () => {
      mockRevokeInvite.mockRejectedValue(new Error('revoke failed'));

      const response = await request(app)
        .delete('/organization/invites/invite-1')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('DELETE /organization', () => {
    it('returns 401 when organization context is missing', async () => {
      const response = await request(app).delete('/organization');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: Missing organization context' });
      expect(mockDeleteOrganization).not.toHaveBeenCalled();
    });

    it('returns 404 when organization does not exist', async () => {
      mockDeleteOrganization.mockResolvedValue(false);

      const response = await request(app).delete('/organization').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Organization not found' });
    });

    it('returns 200 when organization deletion succeeds', async () => {
      const response = await request(app).delete('/organization').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Organization deleted successfully' });
      expect(mockDeleteOrganization).toHaveBeenCalledWith('org-1');
    });

    it('returns 500 for unexpected organization deletion failures', async () => {
      mockDeleteOrganization.mockRejectedValue(new Error('organization delete failure'));

      const response = await request(app).delete('/organization').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });

    it('maps known organization deletion errors to structured payload', async () => {
      mockDeleteOrganization.mockRejectedValue(
        new ValidationError('Organization cannot be deleted'),
      );

      const response = await request(app).delete('/organization').set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Organization cannot be deleted',
        code: 'VALIDATION_ERROR',
      });
    });
  });
});

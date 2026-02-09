import jwt from 'jsonwebtoken';
import { authenticateToken, requireManager, AuthRequest } from '../../middleware/auth.middleware';

const trackEvent = jest.fn();

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
}));

jest.mock('../../services/analytics.service', () => ({
  AnalyticsService: {
    getInstance: () => ({ trackEvent }),
  },
  AnalyticsEventType: {
    USER_LOGOUT: 'USER_LOGOUT',
    VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  },
}));

const makeResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;

  return res;
};

const makeRequest = (overrides: Partial<AuthRequest> = {}): AuthRequest => ({
  headers: {},
  header: jest.fn().mockReturnValue('test-agent'),
  ip: '127.0.0.1',
  get: jest.fn().mockReturnValue('test-agent'),
  path: '/secure',
  method: 'GET',
  ...overrides,
} as AuthRequest);

describe('auth middleware', () => {
  const next = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.TEST_AUTH_BYPASS = 'false';
    process.env.JWT_SECRET = 'test_secret';
    delete process.env.JWT_SECRET_OLD;
  });

  describe('authenticateToken', () => {
    it('rejects when no token is provided', () => {
      const req = makeRequest();
      const res = makeResponse();

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: No token provided' });
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'unauthorized_access_attempt' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects invalid token when verification fails', () => {
      const req = makeRequest({ headers: { authorization: 'Bearer badtoken' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('invalid');
      });

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Invalid token' });
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'invalid_token_attempt' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects invalid token when rotation secret also fails', () => {
      const req = makeRequest({ headers: { authorization: 'Bearer badtoken' } });
      const res = makeResponse();

      process.env.JWT_SECRET_OLD = 'old_secret';
      (jwt.verify as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('invalid current');
        })
        .mockImplementationOnce(() => {
          throw new Error('invalid old');
        });

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Invalid token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when decoded payload is invalid', () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue('not-a-payload');

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Invalid token payload' });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when token is expired', () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 1,
        role: 'Manager',
        exp: Math.floor(Date.now() / 1000) - 10,
      });

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Token has expired' });
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts valid token and sets user fields', () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 7,
        role: 'Manager',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      authenticateToken(req, res, next);

      expect(req.userId).toBe(7);
      expect(req.userRole).toBe('Manager');
      expect(req.user).toEqual({ id: 7, role: 'Manager' });
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'protected_route_access' }),
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireManager', () => {
    it('rejects non-manager roles', () => {
      const req = makeRequest({ userId: 1, userRole: 'Staff' });
      const res = makeResponse();

      requireManager(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Manager role required' });
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'manager_access_denied' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows manager role', () => {
      const req = makeRequest({ userId: 1, userRole: 'Manager' });
      const res = makeResponse();

      requireManager(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AuthService } from '../../services/auth.service';
import { AuthenticationError, InternalError } from '../../errors';
import { SubscriptionStatus } from '../../types/subscription';

// Mock the jsonwebtoken module
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

// Mock the bcrypt module
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

// Mock crypto for refresh tokens
jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({
    toString: jest.fn(() => 'mock_refresh_token_hex'),
  })),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
      },
      subscriptionTier: {
        findFirst: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    } as unknown as PrismaClient;

    authService = new AuthService(prisma);
    (jwt.sign as jest.Mock).mockReturnValue('mock_jwt_token');
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 1,
      role: 'Manager',
      organizationId: 'org-1',
      tierLevel: 'professional',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_pin');
    process.env.JWT_SECRET = 'test_secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePin', () => {
    it('rejects non-digit pins and invalid lengths', () => {
      expect(authService.validatePin('12ab')).toEqual({
        isValid: false,
        message: 'PIN must be 4-6 digits long and contain only numbers',
      });
      expect(authService.validatePin('123')).toEqual({
        isValid: false,
        message: 'PIN must be 4-6 digits long and contain only numbers',
      });
    });

    it('rejects predictable patterns', () => {
      expect(authService.validatePin('1234').isValid).toBe(false);
      expect(authService.validatePin('1111').isValid).toBe(false);
    });

    it('accepts a valid pin', () => {
      expect(authService.validatePin('5624')).toEqual({ isValid: true });
    });
  });

  describe('hashPin', () => {
    it('hashes PIN with bcrypt', async () => {
      const result = await authService.hashPin('5624');

      expect(bcrypt.hash).toHaveBeenCalledWith('5624', 10);
      expect(result).toBe('hashed_pin');
    });
  });

  describe('verifyPin', () => {
    it('verifies PIN with bcrypt', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.verifyPin('5624', 'hashed_pin');

      expect(bcrypt.compare).toHaveBeenCalledWith('5624', 'hashed_pin');
      expect(result).toBe(true);
    });
  });

  describe('login', () => {
    it('always throws AuthenticationError since PIN auth is disabled (Clerk is used)', async () => {
      // PIN auth removed — isValidPin is hardcoded to false in login()
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 1, role: 'Manager', organizationId: 'org-1' },
      ]);

      await expect(authService.login('5624')).rejects.toBeInstanceOf(AuthenticationError);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('throws AuthenticationError when no users exist', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

      await expect(authService.login('5624')).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('throws InternalError on unexpected failures', async () => {
      (prisma.user.findMany as jest.Mock).mockRejectedValue(new Error('DB failure'));

      await expect(authService.login('5624')).rejects.toBeInstanceOf(InternalError);
    });
  });

  describe('generateTokens', () => {
    it('generates access and refresh tokens for a user', async () => {
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 1,
        token: 'mock_refresh_token_hex',
        expiresAt: expect.any(Date),
      });

      const tokens = await authService.generateTokens(1, 'Manager');

      expect(tokens.accessToken).toBe('mock_jwt_token');
      expect(tokens.refreshToken).toBe('mock_refresh_token_hex');
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          token: 'mock_refresh_token_hex',
          expiresAt: expect.any(Date),
        },
      });
    });

    it('throws InternalError on database failure', async () => {
      (prisma.refreshToken.create as jest.Mock).mockRejectedValue(new Error('DB failure'));

      await expect(authService.generateTokens(1, 'Manager')).rejects.toBeInstanceOf(InternalError);
    });
  });

  describe('verifyToken', () => {
    it('successfully verifies and decodes a valid token', () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 7, role: 'Staff', exp: 1234567890 });

      const payload = authService.verifyToken('valid_token');

      expect(payload.userId).toBe(7);
      expect(payload.role).toBe('Staff');
      expect(jwt.verify).toHaveBeenCalledWith('valid_token', 'test_secret');
    });

    it('throws AuthenticationError for expired token', () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        const error: any = new Error('jwt expired');
        error.name = 'TokenExpiredError';
        throw error;
      });

      expect(() => authService.verifyToken('expired_token')).toThrow(AuthenticationError);
    });

    it('throws AuthenticationError for tampered/invalid signature', () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        const error: any = new Error('invalid signature');
        error.name = 'JsonWebTokenError';
        throw error;
      });

      expect(() => authService.verifyToken('tampered_token')).toThrow(AuthenticationError);
    });
  });

  describe('refreshAccessToken', () => {
    it('issues new access token with valid refresh token', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 5,
        token: 'valid_refresh_token',
        expiresAt: futureDate,
        revokedAt: null,
        user: { id: 5, role: 'Staff', pin: 'hashed', createdAt: new Date(), updatedAt: new Date() },
      });

      const newAccessToken = await authService.refreshAccessToken('valid_refresh_token');

      expect(newAccessToken).toBe('mock_jwt_token');
      expect(jwt.sign).toHaveBeenCalledWith({ userId: 5, role: 'Staff' }, 'test_secret', {
        expiresIn: '1h',
      });
    });

    it('throws AuthenticationError for non-existent refresh token', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(authService.refreshAccessToken('invalid_token')).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });

    it('throws AuthenticationError and deletes expired refresh token', async () => {
      const pastDate = new Date(Date.now() - 1000); // Expired
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 5,
        token: 'expired_refresh_token',
        expiresAt: pastDate,
        revokedAt: null,
        user: { id: 5, role: 'Staff', pin: 'hashed', createdAt: new Date(), updatedAt: new Date() },
      });

      await expect(authService.refreshAccessToken('expired_refresh_token')).rejects.toBeInstanceOf(
        AuthenticationError,
      );
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('throws AuthenticationError for revoked refresh token', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 5,
        token: 'revoked_token',
        expiresAt: futureDate,
        revokedAt: new Date(), // Token was revoked
        user: { id: 5, role: 'Staff', pin: 'hashed', createdAt: new Date(), updatedAt: new Date() },
      });

      await expect(authService.refreshAccessToken('revoked_token')).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });
  });

  describe('revokeRefreshToken', () => {
    it('successfully revokes a refresh token', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 5,
        token: 'token_to_revoke',
        expiresAt: new Date(),
      });
      (prisma.refreshToken.update as jest.Mock).mockResolvedValue({});

      await authService.revokeRefreshToken('token_to_revoke');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('silently succeeds when token does not exist', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(authService.revokeRefreshToken('non_existent_token')).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('throws InternalError on database failure', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.refreshToken.update as jest.Mock).mockRejectedValue(new Error('DB failure'));

      await expect(authService.revokeRefreshToken('token')).rejects.toBeInstanceOf(InternalError);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('deletes expired tokens and returns count', async () => {
      (prisma.refreshToken.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      const count = await authService.cleanupExpiredTokens();

      expect(count).toBe(5);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('returns 0 on database failure', async () => {
      (prisma.refreshToken.deleteMany as jest.Mock).mockRejectedValue(new Error('DB failure'));

      const count = await authService.cleanupExpiredTokens();

      expect(count).toBe(0);
    });
  });
});

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AuthService } from '../../services/auth.service';
import { AuthenticationError, InternalError } from '../../errors';

// Mock the jsonwebtoken module
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
}));

// Mock the bcrypt module
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
      },
    } as unknown as PrismaClient;

    authService = new AuthService(prisma);
    (jwt.sign as jest.Mock).mockReturnValue('mock_jwt_token');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_pin');
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
    it('returns a JWT token on successful login', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 1, pin: 'hashed_pin', role: 'Manager' },
      ]);

      const token = await authService.login('5624');

      expect(token).toBe('mock_jwt_token');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        select: { id: true, pin: true, role: true },
      });
      expect(jwt.sign).toHaveBeenCalledWith({ userId: 1, role: 'Manager' }, expect.any(String), {
        expiresIn: '1h',
      });
    });

    it('throws AuthenticationError for invalid PIN', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 1, pin: 'hashed_pin', role: 'Manager' },
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(authService.login('wrong_pin')).rejects.toBeInstanceOf(AuthenticationError);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('throws AuthenticationError when no users match', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

      await expect(authService.login('5624')).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('throws InternalError on unexpected failures', async () => {
      (prisma.user.findMany as jest.Mock).mockRejectedValue(new Error('DB failure'));

      await expect(authService.login('5624')).rejects.toBeInstanceOf(InternalError);
    });
  });
});

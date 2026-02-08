import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AuthService } from '../../services/auth.service';

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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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

  it('returns null for invalid PIN', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 1, pin: 'hashed_pin', role: 'Manager' },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const token = await authService.login('wrong_pin');

    expect(token).toBeNull();
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});

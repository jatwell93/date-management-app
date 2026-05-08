import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Logger } from '../utils/logger';
import { AuthenticationError, InternalError } from '../errors';
import { TierLevel, SubscriptionStatus } from '../types/subscription';
import { envConfig } from '../config/environment';
import crypto from 'crypto';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPayload {
  userId: number;
  role: string;
  organizationId: string;
  tierLevel?: TierLevel;
  iat?: number;
  exp?: number;
}

export interface LoginResponse {
  token: string;
  userId: number;
  role: string;
  organizationId: string;
  tierLevel: TierLevel;
}

export class AuthService {
  private prisma: PrismaClient;
  private readonly ACCESS_TOKEN_EXPIRY = '1h';
  private readonly REFRESH_TOKEN_EXPIRY = '7d';
  private refreshTokenRepo: RefreshTokenRepository;
  private subscriptionRepo: SubscriptionRepository;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.refreshTokenRepo = new RefreshTokenRepository(this.prisma);
    this.subscriptionRepo = new SubscriptionRepository(this.prisma);
  }

  // Validate PIN strength: 4-6 digits, not too predictable
  validatePin(pin: string): { isValid: boolean; message?: string } {
    // Check if PIN is only digits and within length limits
    if (!/^\d{4,6}$/.test(pin)) {
      return {
        isValid: false,
        message: 'PIN must be 4-6 digits long and contain only numbers',
      };
    }

    // Check for common predictable patterns
    if (this.isPredictablePattern(pin)) {
      return {
        isValid: false,
        message: 'PIN contains predictable patterns (e.g. 1234, 1111, etc.) and is not secure',
      };
    }

    return { isValid: true };
  }

  // Check for predictable patterns in the PIN
  private isPredictablePattern(pin: string): boolean {
    // Check for repeating digits (e.g., 1111, 2222)
    if (/^(\d)\1{3,}$/.test(pin)) {
      return true;
    }

    // Check for sequential digits (e.g., 1234, 4321)
    if (this.isSequential(pin)) {
      return true;
    }

    // Check for common patterns like 2580 (vertical on keypad)
    const commonPatterns = [
      '1234',
      '2345',
      '3456',
      '4567',
      '5678',
      '6789',
      '7890',
      '0987',
      '9876',
      '8765',
      '7654',
      '6543',
      '5432',
      '4321',
      '1111',
      '2222',
      '3333',
      '4444',
      '5555',
      '6666',
      '7777',
      '8888',
      '9999',
      '0000',
      '2580',
      '0852',
      '1470',
      '0741',
    ];
    return commonPatterns.includes(pin);
  }

  // Check if the PIN has sequential digits
  private isSequential(pin: string): boolean {
    let isSequential = true;
    // Check increasing sequence
    for (let i = 1; i < pin.length; i++) {
      if (parseInt(pin[i], 10) !== parseInt(pin[i - 1], 10) + 1) {
        isSequential = false;
        break;
      }
    }

    if (isSequential) return true;

    // Check decreasing sequence
    isSequential = true;
    for (let i = 1; i < pin.length; i++) {
      if (parseInt(pin[i], 10) !== parseInt(pin[i - 1], 10) - 1) {
        isSequential = false;
        break;
      }
    }

    return isSequential;
  }

  async hashPin(pin: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(pin, saltRounds);
  }

  async verifyPin(pin: string, hashedPin: string): Promise<boolean> {
    return await bcrypt.compare(pin, hashedPin);
  }

  async login(_pin: string): Promise<LoginResponse> {
    try {
      // Get all users and iterate through them to find a match
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          role: true,
          organizationId: true,
        },
      });
      Logger.debug('Auth service: Attempting to authenticate user', {
        userCount: users.length,
      });

      // Look for a user whose hashed pin matches the PIN that was provided
      for (const user of users) {
        Logger.debug('Auth service: Checking user for authentication', { userId: user.id });

        const isValidPin = false; // PIN auth removed — use Clerk authentication
        if (isValidPin) {
          // Verify user has an organization
          if (!user.organizationId) {
            Logger.error('Auth service: User has no organization assigned', { userId: user.id });
            throw new AuthenticationError('User organization not configured');
          }

          // Query organization and its subscription tier
          const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
            where: { organizationId: user.organizationId },
            orderBy: { createdAt: 'desc' },
          });

          if (!subscriptionTier) {
            Logger.error('Auth service: No subscription tier found for organization', {
              organizationId: user.organizationId,
            });
            throw new AuthenticationError('Organization subscription not configured');
          }

          // Verify organization subscription is not canceled
          if (subscriptionTier.status === SubscriptionStatus.CANCELED) {
            Logger.warn('Auth service: Login attempt for canceled organization', {
              organizationId: user.organizationId,
              userId: user.id,
            });
            throw new AuthenticationError(
              'Organization subscription has been canceled. Please contact support.',
            );
          }

          Logger.info('Auth service: User authenticated successfully', {
            userId: user.id,
            organizationId: user.organizationId,
            tierLevel: subscriptionTier.tierLevel,
            role: user.role,
          });

          const token = jwt.sign(
            {
              userId: user.id,
              role: user.role,
              organizationId: user.organizationId,
              tierLevel: subscriptionTier.tierLevel,
            },
            envConfig.JWT_SECRET,
            {
              expiresIn: '1h', // Token expires in 1 hour
            },
          );

          return {
            token,
            userId: user.id,
            role: user.role,
            organizationId: user.organizationId,
            tierLevel: subscriptionTier.tierLevel as TierLevel,
          };
        }
      }

      Logger.warn('Auth service: Authentication failed for provided PIN');
      throw new AuthenticationError('Invalid PIN');
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      Logger.error('Auth service: Error during authentication', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new InternalError('Authentication failed');
    }
  }

  /**
   * Generate both access and refresh tokens for a user
   */
  async generateTokens(
    userId: number,
    role: string,
    organizationId: string,
    tierLevel?: TierLevel,
  ): Promise<TokenPair> {
    try {
      const secret = envConfig.JWT_SECRET;

      // Generate access token (short-lived)
      const accessToken = jwt.sign({ userId, role, organizationId, tierLevel }, secret, {
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
      });

      // Generate refresh token (long-lived)
      const refreshToken = crypto.randomBytes(64).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

      // Store refresh token in database
      await this.refreshTokenRepo.create({ userId, token: refreshToken, expiresAt });

      Logger.info('Auth service: Generated token pair', { userId });
      return { accessToken, refreshToken };
    } catch (error) {
      Logger.error('Auth service: Error generating tokens', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new InternalError('Token generation failed');
    }
  }

  /**
   * Verify and decode a JWT access token
   */
  verifyToken(token: string): TokenPayload {
    try {
      const secret = envConfig.JWT_SECRET;
      const decoded = jwt.verify(token, secret) as TokenPayload;
      return decoded;
    } catch (error) {
      Logger.warn('Auth service: Token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AuthenticationError('Invalid or expired token');
    }
  }

  /**
   * Refresh access token using a valid refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      // Find refresh token in database
      const storedToken = await this.refreshTokenRepo.findByTokenWithUser(refreshToken);

      if (!storedToken) {
        Logger.warn('Auth service: Refresh token not found');
        throw new AuthenticationError('Invalid refresh token');
      }

      // Check if token is expired
      if (storedToken.expiresAt < new Date()) {
        // Clean up expired token
        await this.refreshTokenRepo.delete(storedToken.id);
        Logger.warn('Auth service: Refresh token expired', { userId: storedToken.userId });
        throw new AuthenticationError('Refresh token expired');
      }

      // Check if token is revoked
      if (storedToken.revokedAt) {
        Logger.warn('Auth service: Refresh token revoked', { userId: storedToken.userId });
        throw new AuthenticationError('Refresh token revoked');
      }

      // Generate new access token with fresh tierLevel from database
      const secret = envConfig.JWT_SECRET;

      // Fetch current tierLevel from subscription to ensure token has latest tier
      const subscription = await this.subscriptionRepo.findByOrganizationId(
        storedToken.user.organizationId!,
      );
      const tierLevel = subscription?.tierLevel as TierLevel | undefined;

      const accessToken = jwt.sign(
        {
          userId: storedToken.userId,
          role: storedToken.user.role,
          organizationId: storedToken.user.organizationId,
          tierLevel,
        },
        secret,
        { expiresIn: this.ACCESS_TOKEN_EXPIRY },
      );

      Logger.info('Auth service: Access token refreshed', { userId: storedToken.userId });
      return accessToken;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      Logger.error('Auth service: Error refreshing access token', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new InternalError('Token refresh failed');
    }
  }

  /**
   * Revoke a refresh token (e.g., on logout)
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      const storedToken = await this.refreshTokenRepo.findByToken(refreshToken);

      if (!storedToken) {
        Logger.warn('Auth service: Attempt to revoke non-existent token');
        return; // Silently succeed if token doesn't exist
      }

      await this.refreshTokenRepo.revoke(storedToken.id);

      Logger.info('Auth service: Refresh token revoked', { userId: storedToken.userId });
    } catch (error) {
      Logger.error('Auth service: Error revoking token', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new InternalError('Token revocation failed');
    }
  }

  /**
   * Clean up expired refresh tokens (should be run periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const count = await this.refreshTokenRepo.deleteExpired();

      Logger.info('Auth service: Cleaned up expired tokens', { count });
      return count;
    } catch (error) {
      Logger.error('Auth service: Error cleaning up expired tokens', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_factory_1 = require("../database/database-factory");
const logger_1 = require("../utils/logger");
const errors_1 = require("../errors");
const crypto_1 = __importDefault(require("crypto"));
class AuthService {
    constructor(prismaClient) {
        this.ACCESS_TOKEN_EXPIRY = '1h';
        this.REFRESH_TOKEN_EXPIRY = '7d';
        this.prisma = prismaClient ?? (0, database_factory_1.getDefaultDatabaseClient)();
    }
    // Validate PIN strength: 4-6 digits, not too predictable
    validatePin(pin) {
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
    isPredictablePattern(pin) {
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
    isSequential(pin) {
        let isSequential = true;
        // Check increasing sequence
        for (let i = 1; i < pin.length; i++) {
            if (parseInt(pin[i]) !== parseInt(pin[i - 1]) + 1) {
                isSequential = false;
                break;
            }
        }
        if (isSequential)
            return true;
        // Check decreasing sequence
        isSequential = true;
        for (let i = 1; i < pin.length; i++) {
            if (parseInt(pin[i]) !== parseInt(pin[i - 1]) - 1) {
                isSequential = false;
                break;
            }
        }
        return isSequential;
    }
    async hashPin(pin) {
        const saltRounds = 10;
        return await bcrypt_1.default.hash(pin, saltRounds);
    }
    async verifyPin(pin, hashedPin) {
        return await bcrypt_1.default.compare(pin, hashedPin);
    }
    async login(pin) {
        try {
            // Get all users and iterate through them to find a match
            const users = await this.prisma.user.findMany({
                select: { id: true, pin: true, role: true },
            });
            logger_1.Logger.debug('Auth service: Attempting to authenticate user', {
                userCount: users.length,
            });
            // Look for a user whose hashed pin matches the PIN that was provided
            for (const user of users) {
                logger_1.Logger.debug('Auth service: Checking user for authentication', { userId: user.id });
                const isValidPin = await bcrypt_1.default.compare(pin, user.pin);
                if (isValidPin) {
                    logger_1.Logger.info('Auth service: User authenticated successfully', {
                        userId: user.id,
                        role: user.role,
                    });
                    const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'your_jwt_secret', {
                        expiresIn: '1h', // Token expires in 1 hour
                    });
                    return token;
                }
            }
            logger_1.Logger.warn('Auth service: Authentication failed for provided PIN');
            throw new errors_1.AuthenticationError('Invalid PIN');
        }
        catch (error) {
            if (error instanceof errors_1.AuthenticationError) {
                throw error;
            }
            logger_1.Logger.error('Auth service: Error during authentication', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw new errors_1.InternalError('Authentication failed');
        }
    }
    /**
     * Generate both access and refresh tokens for a user
     */
    async generateTokens(userId, role) {
        try {
            const secret = process.env.JWT_SECRET || 'your_jwt_secret';
            // Generate access token (short-lived)
            const accessToken = jsonwebtoken_1.default.sign({ userId, role }, secret, {
                expiresIn: this.ACCESS_TOKEN_EXPIRY,
            });
            // Generate refresh token (long-lived)
            const refreshToken = crypto_1.default.randomBytes(64).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now
            // Store refresh token in database
            await this.prisma.refreshToken.create({
                data: {
                    userId,
                    token: refreshToken,
                    expiresAt,
                },
            });
            logger_1.Logger.info('Auth service: Generated token pair', { userId });
            return { accessToken, refreshToken };
        }
        catch (error) {
            logger_1.Logger.error('Auth service: Error generating tokens', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw new errors_1.InternalError('Token generation failed');
        }
    }
    /**
     * Verify and decode a JWT access token
     */
    verifyToken(token) {
        try {
            const secret = process.env.JWT_SECRET || 'your_jwt_secret';
            const decoded = jsonwebtoken_1.default.verify(token, secret);
            return decoded;
        }
        catch (error) {
            logger_1.Logger.warn('Auth service: Token verification failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw new errors_1.AuthenticationError('Invalid or expired token');
        }
    }
    /**
     * Refresh access token using a valid refresh token
     */
    async refreshAccessToken(refreshToken) {
        try {
            // Find refresh token in database
            const storedToken = await this.prisma.refreshToken.findUnique({
                where: { token: refreshToken },
                include: { user: true },
            });
            if (!storedToken) {
                logger_1.Logger.warn('Auth service: Refresh token not found');
                throw new errors_1.AuthenticationError('Invalid refresh token');
            }
            // Check if token is expired
            if (storedToken.expiresAt < new Date()) {
                // Clean up expired token
                await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
                logger_1.Logger.warn('Auth service: Refresh token expired', { userId: storedToken.userId });
                throw new errors_1.AuthenticationError('Refresh token expired');
            }
            // Check if token is revoked
            if (storedToken.revokedAt) {
                logger_1.Logger.warn('Auth service: Refresh token revoked', { userId: storedToken.userId });
                throw new errors_1.AuthenticationError('Refresh token revoked');
            }
            // Generate new access token
            const secret = process.env.JWT_SECRET || 'your_jwt_secret';
            const accessToken = jsonwebtoken_1.default.sign({ userId: storedToken.userId, role: storedToken.user.role }, secret, { expiresIn: this.ACCESS_TOKEN_EXPIRY });
            logger_1.Logger.info('Auth service: Access token refreshed', { userId: storedToken.userId });
            return accessToken;
        }
        catch (error) {
            if (error instanceof errors_1.AuthenticationError) {
                throw error;
            }
            logger_1.Logger.error('Auth service: Error refreshing access token', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw new errors_1.InternalError('Token refresh failed');
        }
    }
    /**
     * Revoke a refresh token (e.g., on logout)
     */
    async revokeRefreshToken(refreshToken) {
        try {
            const storedToken = await this.prisma.refreshToken.findUnique({
                where: { token: refreshToken },
            });
            if (!storedToken) {
                logger_1.Logger.warn('Auth service: Attempt to revoke non-existent token');
                return; // Silently succeed if token doesn't exist
            }
            await this.prisma.refreshToken.update({
                where: { id: storedToken.id },
                data: { revokedAt: new Date() },
            });
            logger_1.Logger.info('Auth service: Refresh token revoked', { userId: storedToken.userId });
        }
        catch (error) {
            logger_1.Logger.error('Auth service: Error revoking token', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw new errors_1.InternalError('Token revocation failed');
        }
    }
    /**
     * Clean up expired refresh tokens (should be run periodically)
     */
    async cleanupExpiredTokens() {
        try {
            const result = await this.prisma.refreshToken.deleteMany({
                where: {
                    expiresAt: { lt: new Date() },
                },
            });
            logger_1.Logger.info('Auth service: Cleaned up expired tokens', { count: result.count });
            return result.count;
        }
        catch (error) {
            logger_1.Logger.error('Auth service: Error cleaning up expired tokens', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return 0;
        }
    }
}
exports.AuthService = AuthService;

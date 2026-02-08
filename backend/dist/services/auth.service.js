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
class AuthService {
    constructor(prismaClient) {
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
            return null;
        }
        catch (error) {
            logger_1.Logger.error('Auth service: Error during authentication', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
            });
            return null;
        }
    }
}
exports.AuthService = AuthService;

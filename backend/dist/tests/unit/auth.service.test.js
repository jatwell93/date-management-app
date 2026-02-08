"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const auth_service_1 = require("../../services/auth.service");
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
    let authService;
    let prisma;
    beforeEach(() => {
        prisma = {
            user: {
                findMany: jest.fn(),
            },
        };
        authService = new auth_service_1.AuthService(prisma);
        jsonwebtoken_1.default.sign.mockReturnValue('mock_jwt_token');
        bcrypt_1.default.compare.mockResolvedValue(true);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('returns a JWT token on successful login', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: 1, pin: 'hashed_pin', role: 'Manager' },
        ]);
        const token = await authService.login('5624');
        expect(token).toBe('mock_jwt_token');
        expect(prisma.user.findMany).toHaveBeenCalledWith({
            select: { id: true, pin: true, role: true },
        });
        expect(jsonwebtoken_1.default.sign).toHaveBeenCalledWith({ userId: 1, role: 'Manager' }, expect.any(String), {
            expiresIn: '1h',
        });
    });
    it('returns null for invalid PIN', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: 1, pin: 'hashed_pin', role: 'Manager' },
        ]);
        bcrypt_1.default.compare.mockResolvedValue(false);
        const token = await authService.login('wrong_pin');
        expect(token).toBeNull();
        expect(jsonwebtoken_1.default.sign).not.toHaveBeenCalled();
    });
});

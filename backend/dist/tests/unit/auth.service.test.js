"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const auth_service_1 = require("../../services/auth.service");
const database_1 = require("../../database");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
// Mock the database module
jest.mock("../../database", () => ({
    getDb: jest.fn(),
}));
// Mock the jsonwebtoken module
jest.mock("jsonwebtoken", () => ({
    sign: jest.fn(),
}));
// Mock the bcrypt module
jest.mock("bcrypt", () => ({
    hash: jest.fn(),
    compare: jest.fn(),
}));
describe("AuthService", () => {
    let authService;
    let mockDb;
    beforeEach(() => {
        authService = new auth_service_1.AuthService();
        mockDb = {
            get: jest.fn(),
        };
        database_1.getDb.mockResolvedValue(mockDb);
        jsonwebtoken_1.default.sign.mockReturnValue("mock_jwt_token");
        bcrypt_1.default.hash.mockResolvedValue("hashed_pin");
        bcrypt_1.default.compare.mockResolvedValue(true);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("should return a JWT token on successful login", async () => {
        mockDb.get.mockResolvedValue({ id: 1, pin: "hashed_pin", role: "Manager" });
        const token = await authService.login("1234");
        expect(token).toBe("mock_jwt_token");
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.get).toHaveBeenCalledWith("SELECT * FROM users WHERE pin = ?", "1234");
        expect(jsonwebtoken_1.default.sign).toHaveBeenCalledWith({ userId: 1, role: "Manager" }, expect.any(String), { expiresIn: "1h" });
    });
    it("should return null for invalid PIN", async () => {
        mockDb.get.mockResolvedValue(undefined);
        const token = await authService.login("wrong_pin");
        expect(token).toBeNull();
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.get).toHaveBeenCalledWith("SELECT * FROM users WHERE pin = ?", "wrong_pin");
        expect(jsonwebtoken_1.default.sign).not.toHaveBeenCalled();
    });
});

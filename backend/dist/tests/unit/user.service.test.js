"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const user_service_1 = require("../../services/user.service");
const database_1 = require("../../database");
const auth_service_1 = require("../../services/auth.service");
// Mock the database connection
jest.mock("../../database", () => ({
    getDb: jest.fn(),
}));
describe("User Service", () => {
    const mockStatement = {
        run: jest.fn(),
        all: jest.fn(),
        get: jest.fn(),
    };
    const mockDb = {
        prepare: jest.fn(() => mockStatement),
    };
    beforeEach(() => {
        database_1.getDb.mockResolvedValue(mockDb);
        jest.clearAllMocks();
    });
    describe("createUser", () => {
        it("should create a user successfully", async () => {
            const mockUser = { pin: "123456", role: "Manager" };
            const mockResult = { lastInsertRowid: 1 };
            mockStatement.run.mockReturnValue(mockResult);
            const validatePinSpy = jest.spyOn(auth_service_1.AuthService.prototype, 'validatePin').mockReturnValue({ isValid: true });
            const hashPinSpy = jest.spyOn(auth_service_1.AuthService.prototype, 'hashPin').mockResolvedValue("hashed_pin");
            const result = await (0, user_service_1.createUser)(mockUser);
            expect(validatePinSpy).toHaveBeenCalledWith(mockUser.pin);
            expect(hashPinSpy).toHaveBeenCalledWith(mockUser.pin);
            expect(mockDb.prepare).toHaveBeenCalledWith("INSERT INTO users (pin, role) VALUES (?, ?)");
            expect(mockStatement.run).toHaveBeenCalledWith("hashed_pin", mockUser.role);
            expect(result).toEqual({ id: 1, ...mockUser, pin: "hashed_pin" });
        });
    });
    describe("getUsers", () => {
        it("should get all users successfully", async () => {
            const mockUsers = [
                {
                    id: 1,
                    pin: "hashed_pin",
                    role: "Manager",
                    created_at: "2023-01-01",
                    updated_at: "2023-01-01",
                },
            ];
            mockStatement.all.mockReturnValue(mockUsers);
            const result = await (0, user_service_1.getUsers)();
            expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users");
            expect(mockStatement.all).toHaveBeenCalledWith();
            expect(result).toEqual(mockUsers);
        });
    });
    describe("getUserById", () => {
        it("should get a user by ID successfully", async () => {
            const mockUser = {
                id: 1,
                pin: "hashed_pin",
                role: "Manager",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            };
            mockStatement.get.mockReturnValue(mockUser);
            const result = await (0, user_service_1.getUserById)(1);
            expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?");
            expect(mockStatement.get).toHaveBeenCalledWith(1);
            expect(result).toEqual(mockUser);
        });
        it("should return undefined when user is not found", async () => {
            mockStatement.get.mockReturnValue(undefined);
            const result = await (0, user_service_1.getUserById)(999);
            expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?");
            expect(mockStatement.get).toHaveBeenCalledWith(999);
            expect(result).toBeUndefined();
        });
    });
    describe("getUserByPin", () => {
        it("should get a user by PIN successfully", async () => {
            const mockUsers = [
                {
                    id: 1,
                    pin: "hashed_pin",
                    role: "Manager",
                    created_at: "2023-01-01",
                    updated_at: "2023-01-01",
                },
            ];
            mockStatement.all.mockReturnValue(mockUsers);
            const verifyPinSpy = jest.spyOn(auth_service_1.AuthService.prototype, 'verifyPin').mockResolvedValue(true);
            const result = await (0, user_service_1.getUserByPin)("123456");
            expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users");
            expect(mockStatement.all).toHaveBeenCalledWith();
            expect(verifyPinSpy).toHaveBeenCalledWith("123456", "hashed_pin");
            expect(result).toEqual(mockUsers[0]);
        });
        it("should return undefined when user is not found", async () => {
            mockStatement.all.mockReturnValue([]);
            const result = await (0, user_service_1.getUserByPin)("9999");
            expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users");
            expect(mockStatement.all).toHaveBeenCalledWith();
            expect(result).toBeUndefined();
        });
    });
    describe("updateUser", () => {
        it("should update a user successfully", async () => {
            mockStatement.run.mockReturnValue({ changes: 1 });
            const result = await (0, user_service_1.updateUser)(1, { role: "Team Member" });
            expect(mockDb.prepare).toHaveBeenCalledWith("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
            expect(mockStatement.run).toHaveBeenCalledWith("Team Member", 1);
            expect(result).toBe(true);
        });
        it("should return false when user is not found", async () => {
            mockStatement.run.mockReturnValue({ changes: 0 });
            const result = await (0, user_service_1.updateUser)(999, { role: "Team Member" });
            expect(result).toBe(false);
        });
    });
    describe("deleteUser", () => {
        it("should delete a user successfully", async () => {
            mockStatement.run.mockReturnValue({ changes: 1 });
            const result = await (0, user_service_1.deleteUser)(1);
            expect(mockDb.prepare).toHaveBeenCalledWith("DELETE FROM users WHERE id = ?");
            expect(mockStatement.run).toHaveBeenCalledWith(1);
            expect(result).toBe(true);
        });
        it("should return false when user is not found", async () => {
            mockStatement.run.mockReturnValue({ changes: 0 });
            const result = await (0, user_service_1.deleteUser)(999);
            expect(result).toBe(false);
        });
    });
});

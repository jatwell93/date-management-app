"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const database_1 = require("../../database");
// Mock the database connection
jest.mock("../../database", () => ({
    getDb: jest.fn(),
}));
describe("User API Integration Tests", () => {
    const mockDb = {
        run: jest.fn(),
        all: jest.fn(),
        get: jest.fn(),
    };
    beforeEach(() => {
        database_1.getDb.mockResolvedValue(mockDb);
        jest.clearAllMocks();
    });
    describe("POST /auth/login", () => {
        it("should login successfully with valid PIN", async () => {
            const mockUser = {
                id: 1,
                pin: "5624",
                role: "Manager",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            };
            mockDb.get.mockResolvedValue(mockUser);
            const response = await (0, supertest_1.default)(index_1.default)
                .post("/auth/login")
                .send({ pin: "5624" })
                .expect(200);
            expect(response.body).toHaveProperty("token");
        });
        it("should return 401 for invalid PIN", async () => {
            mockDb.get.mockResolvedValue(undefined);
            await (0, supertest_1.default)(index_1.default)
                .post("/auth/login")
                .send({ pin: "wrongpin" })
                .expect(401);
        });
    });
    describe("GET /users (Manager only)", () => {
        it("should return 401 for unauthorized access", async () => {
            await (0, supertest_1.default)(index_1.default).get("/users").expect(401);
        });
        it("should return all users when accessed by manager", async () => {
            const mockUser = {
                id: 1,
                pin: "5624",
                role: "Manager",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            };
            mockDb.get.mockResolvedValue(mockUser);
            mockDb.all.mockResolvedValue([
                {
                    id: 1,
                    pin: "5624",
                    role: "Manager",
                    created_at: "2023-01-01",
                    updated_at: "2023-01-01",
                },
                {
                    id: 2,
                    pin: "5678",
                    role: "Team Member",
                    created_at: "2023-01-01",
                    updated_at: "2023-01-01",
                },
            ]);
            // Mock authentication with a manager token
            const authResponse = await (0, supertest_1.default)(index_1.default)
                .post("/auth/login")
                .send({ pin: "5624" });
            const token = authResponse.body.token;
            const response = await (0, supertest_1.default)(index_1.default)
                .get("/users")
                .set("Authorization", `Bearer ${token}`)
                .expect(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBe(2);
        });
    });
    describe("POST /users (Manager only)", () => {
        it("should create a new user when accessed by manager", async () => {
            const mockUser = {
                id: 1,
                pin: "5624",
                role: "Manager",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            };
            mockDb.get.mockResolvedValue(mockUser);
            mockDb.run.mockResolvedValue({ lastID: 2 });
            const authResponse = await (0, supertest_1.default)(index_1.default)
                .post("/auth/login")
                .send({ pin: "5624" });
            const token = authResponse.body.token;
            const response = await (0, supertest_1.default)(index_1.default)
                .post("/users")
                .set("Authorization", `Bearer ${token}`)
                .send({ pin: "5678", role: "Team Member" })
                .expect(201);
            expect(response.body).toHaveProperty("id");
            expect(response.body.role).toBe("Team Member");
        });
    });
    describe("PUT /users/:id (Manager only)", () => {
        it("should update a user when accessed by manager", async () => {
            const mockUser = {
                id: 1,
                pin: "5624",
                role: "Manager",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            };
            mockDb.get.mockResolvedValue(mockUser);
            mockDb.run.mockResolvedValue({ changes: 1 });
            mockDb.get.mockResolvedValueOnce(mockUser);
            mockDb.get.mockResolvedValueOnce({
                id: 2,
                pin: "5678",
                role: "Updated Team Member",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            });
            const authResponse = await (0, supertest_1.default)(index_1.default)
                .post("/auth/login")
                .send({ pin: "5624" });
            const token = authResponse.body.token;
            const response = await (0, supertest_1.default)(index_1.default)
                .put("/users/2")
                .set("Authorization", `Bearer ${token}`)
                .send({ role: "Updated Team Member" })
                .expect(200);
            expect(response.body.role).toBe("Updated Team Member");
        });
    });
    describe("DELETE /users/:id (Manager only)", () => {
        it("should delete a user when accessed by manager", async () => {
            const mockUser = {
                id: 1,
                pin: "5624",
                role: "Manager",
                created_at: "2023-01-01",
                updated_at: "2023-01-01",
            };
            mockDb.get.mockResolvedValue(mockUser);
            mockDb.run.mockResolvedValue({ changes: 1 });
            const authResponse = await (0, supertest_1.default)(index_1.default)
                .post("/auth/login")
                .send({ pin: "5624" });
            const token = authResponse.body.token;
            await (0, supertest_1.default)(index_1.default)
                .delete("/users/2")
                .set("Authorization", `Bearer ${token}`)
                .expect(200);
        });
    });
});

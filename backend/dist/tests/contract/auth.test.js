"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
describe("POST /auth/login", () => {
    it("should respond with a 200 status code and a token for valid credentials", async () => {
        // This test will fail with a connection refused error until the server is running
        // and the endpoint is implemented. This is the correct TDD workflow.
        const response = await (0, supertest_1.default)(index_1.default)
            .post("/auth/login")
            .send({ pin: "5624" });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("token");
    });
});

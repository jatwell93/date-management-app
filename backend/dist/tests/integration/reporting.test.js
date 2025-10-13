"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const express_1 = __importDefault(require("express"));
index_1.default.use(express_1.default.json());
describe('"Manager Report" Integration Scenario', () => {
    it("should allow a manager to generate a monthly markdown report", async () => {
        // Step 1: Log in as a manager (simulate by getting a token)
        const loginResponse = await (0, supertest_1.default)(index_1.default)
            .post("/auth/login")
            .send({ pin: "5624" }); // Default manager PIN
        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.token;
        expect(token).toBeDefined();
        // Step 2: Request the monthly markdown report
        const reportResponse = await (0, supertest_1.default)(index_1.default)
            .get("/reports/monthly-markdown")
            .set("Authorization", `Bearer ${token}`);
        expect(reportResponse.status).toBe(200);
        expect(reportResponse.headers["content-type"]).toEqual("application/pdf");
    });
});

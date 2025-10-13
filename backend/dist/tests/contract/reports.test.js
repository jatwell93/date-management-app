"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
describe("GET /reports/monthly-markdown", () => {
    it("should respond with a 200 status code and a PDF file", async () => {
        const response = await (0, supertest_1.default)(index_1.default).get("/reports/monthly-markdown");
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toEqual("application/pdf");
    });
});
describe("GET /reports/usage", () => {
    it("should respond with a 200 status code and usage data", async () => {
        const response = await (0, supertest_1.default)(index_1.default).get("/reports/usage");
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("usage_data");
        expect(Array.isArray(response.body.usage_data)).toBe(true);
    });
});

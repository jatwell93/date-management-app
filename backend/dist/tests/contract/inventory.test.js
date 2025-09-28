"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const express_1 = __importDefault(require("express"));
index_1.default.use(express_1.default.json());
describe("POST /inventory-items", () => {
    it("should respond with a 201 status code and the created item", async () => {
        const newItem = {
            product_id: 1,
            expiry_date: "2026-12-31",
            location_id: 1,
        };
        const response = await (0, supertest_1.default)(index_1.default).post("/inventory-items").send(newItem);
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("id");
        expect(response.body).toHaveProperty("status", "Normal");
    });
});

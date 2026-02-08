"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
describe('GET /dashboard', () => {
    it('should respond with a 200 status code and dashboard data', async () => {
        const response = await (0, supertest_1.default)(index_1.default).get('/dashboard');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('expiringSoon');
        expect(response.body).toHaveProperty('markdownItems');
        expect(response.body).toHaveProperty('recentActivity');
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const express_1 = __importDefault(require("express"));
index_1.default.use(express_1.default.json());
describe('"Manager Dashboard" Integration Scenario', () => {
    it('should allow a manager to view the dashboard', async () => {
        // Step 1: Log in as a manager (simulate by getting a token)
        const loginResponse = await (0, supertest_1.default)(index_1.default).post('/auth/login').send({ pin: '5624' }); // Default manager PIN
        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.token;
        expect(token).toBeDefined();
        // Step 2: Request the dashboard data
        const dashboardResponse = await (0, supertest_1.default)(index_1.default)
            .get('/dashboard')
            .set('Authorization', `Bearer ${token}`);
        expect(dashboardResponse.status).toBe(200);
        expect(dashboardResponse.body).toHaveProperty('totalProducts');
        expect(dashboardResponse.body).toHaveProperty('expiringSoon');
        expect(dashboardResponse.body).toHaveProperty('markdownItems');
        expect(dashboardResponse.body).toHaveProperty('recentActivity');
    });
});

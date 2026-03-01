"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
describe('"Manager Dashboard" Integration Scenario', () => {
    const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;
    afterEach(() => {
        process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
    });
    it('should allow a manager to view the dashboard', async () => {
        // Use test auth bypass instead of removed /auth/login endpoint
        process.env.TEST_AUTH_BYPASS = 'true';
        // Request the dashboard data (auth bypass injects manager user)
        const dashboardResponse = await (0, supertest_1.default)(index_1.default).get('/dashboard');
        expect(dashboardResponse.status).toBe(200);
        expect(dashboardResponse.body).toHaveProperty('totalProducts');
        expect(dashboardResponse.body).toHaveProperty('expiringSoon');
        expect(dashboardResponse.body).toHaveProperty('markdownItems');
        expect(dashboardResponse.body).toHaveProperty('recentActivity');
    });
});

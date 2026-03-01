"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
describe('"Manager Report" Integration Scenario', () => {
    const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;
    afterEach(() => {
        process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
    });
    it('should allow a manager to generate a monthly markdown report', async () => {
        // Use test auth bypass instead of removed /auth/login endpoint
        process.env.TEST_AUTH_BYPASS = 'true';
        // Request the monthly markdown report (auth bypass injects manager user)
        const reportResponse = await (0, supertest_1.default)(index_1.default).get('/reports/monthly-markdown');
        expect(reportResponse.status).toBe(200);
        expect(reportResponse.headers['content-type']).toContain('application/json');
        expect(Array.isArray(reportResponse.body)).toBe(true);
    });
});

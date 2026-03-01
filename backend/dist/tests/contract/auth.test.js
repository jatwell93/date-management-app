"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
describe('POST /auth/logout', () => {
    const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;
    afterEach(() => {
        process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
    });
    it('returns 200 when test auth bypass is enabled', async () => {
        process.env.TEST_AUTH_BYPASS = 'true';
        const response = await (0, supertest_1.default)(index_1.default).post('/auth/logout').send();
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Logged out successfully' });
    });
    it('returns 401 when bypass is disabled and Authorization header is missing', async () => {
        process.env.TEST_AUTH_BYPASS = 'false';
        const response = await (0, supertest_1.default)(index_1.default).post('/auth/logout').send();
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });
});

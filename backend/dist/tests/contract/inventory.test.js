"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Mock auth middleware to bypass check
jest.mock('../../middleware/auth.middleware', () => ({
    authenticateToken: (req, res, next) => {
        req.user = { id: 1, role: 'Manager', organizationId: 'default-org', tierLevel: 'professional' };
        req.userId = 1;
        req.userRole = 'Manager';
        req.organizationId = 'default-org';
        req.tierLevel = 'professional';
        next();
    },
    requireManager: (_req, _res, next) => next(),
}));
const supertest_1 = __importDefault(require("supertest"));
const database_factory_1 = require("../../database/database-factory");
const index_1 = __importDefault(require("../../index"));
const express_1 = __importDefault(require("express"));
index_1.default.use(express_1.default.json());
const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
let productId;
let locationId;
beforeEach(async () => {
    const now = Date.now();
    const uniqueSuffix = Math.random().toString(36).slice(2, 10);
    // Ensure default-org and test user exist
    await prisma.organization.upsert({
        where: { id: 'default-org' },
        update: {},
        create: {
            id: 'default-org',
            name: 'Default Test Org',
            slug: `default-org-${uniqueSuffix}`,
            contactEmail: 'test@default.org',
        },
    });
    await prisma.user.upsert({
        where: { id: 1 },
        update: { organizationId: 'default-org' },
        create: { id: 1, role: 'Manager', organizationId: 'default-org' },
    });
    const product = await prisma.product.create({
        data: {
            barcode: `CONTRACT-BARCODE-${now}-${uniqueSuffix}`,
            sku: `CONTRACT-SKU-${now}-${uniqueSuffix}`,
            name: 'Contract Test Product',
            costPrice: 5,
            notes: '',
            organizationId: 'default-org',
        },
    });
    const storeArea = await prisma.storeArea.create({
        data: {
            name: `Contract Area ${now}-${uniqueSuffix}`,
            subDepartment: 'Test',
            organizationId: 'default-org',
        },
    });
    productId = product.id;
    locationId = storeArea.id;
});
afterAll(async () => {
    await (0, database_factory_1.disconnectDatabase)();
});
describe('POST /inventory-items', () => {
    it('should respond with a 201 status code and the created item', async () => {
        const newItem = {
            productId,
            expiryDate: '2026-12-31',
            locationId,
        };
        const response = await (0, supertest_1.default)(index_1.default).post('/inventory-items').send(newItem);
        if (response.status !== 201) {
            console.log('Inventory POST failed:', response.status, response.body);
        }
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('status', 'Normal');
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const database_factory_1 = require("../../database/database-factory");
const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
describe('"Scan & Save" Integration Scenario', () => {
    const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;
    afterEach(() => {
        process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
    });
    afterAll(async () => {
        await (0, database_factory_1.disconnectDatabase)();
    });
    it('should allow scanning a product and saving it as an inventory item', async () => {
        // Use test auth bypass instead of removed /auth/login endpoint
        process.env.TEST_AUTH_BYPASS = 'true';
        // Ensure default-org exists (matches TEST_AUTH_BYPASS organizationId)
        const now = Date.now();
        const uniqueSuffix = Math.random().toString(36).slice(2, 10);
        await prisma.organization.upsert({
            where: { id: 'default-org' },
            update: {},
            create: {
                id: 'default-org',
                name: 'Default Test Org',
                slug: `default-test-org-${uniqueSuffix}`,
                contactEmail: 'test@default.org',
            },
        });
        // Ensure test user exists (matches TEST_AUTH_BYPASS userId: 1)
        await prisma.user.upsert({
            where: { id: 1 },
            update: { organizationId: 'default-org' },
            create: {
                id: 1,
                role: 'Manager',
                organizationId: 'default-org',
            },
        });
        const barcode = `SCAN-${now}-${uniqueSuffix}`;
        const product = await prisma.product.create({
            data: {
                barcode,
                name: 'Test Product',
                sku: `TEST-SKU-${now}-${uniqueSuffix}`,
                costPrice: 10.99,
                organizationId: 'default-org',
            },
        });
        const storeArea = await prisma.storeArea.create({
            data: {
                name: `Scan Area ${now}-${uniqueSuffix}`,
                subDepartment: 'Test',
                organizationId: 'default-org',
            },
        });
        // Step 1: Scan a product (simulate by getting product by barcode)
        const getProductResponse = await (0, supertest_1.default)(index_1.default).get(`/products/by-barcode/${barcode}`);
        expect(getProductResponse.status).toBe(200);
        const fetchedProduct = getProductResponse.body;
        expect(fetchedProduct).toHaveProperty('id');
        // Step 2: Save the scanned product as an inventory item
        const newItem = {
            productId: product.id,
            locationId: storeArea.id,
            expiryDate: '2026-12-31',
            status: 'Normal',
        };
        const postInventoryResponse = await (0, supertest_1.default)(index_1.default).post('/inventory-items').send(newItem);
        expect(postInventoryResponse.status).toBe(201);
        expect(postInventoryResponse.body).toHaveProperty('id');
        expect(postInventoryResponse.body).toHaveProperty('productId', product.id);
    });
});

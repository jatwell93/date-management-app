"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const express_1 = __importDefault(require("express"));
const database_factory_1 = require("../../database/database-factory");
const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
index_1.default.use(express_1.default.json());
describe('"Scan & Save" Integration Scenario', () => {
    afterAll(async () => {
        await (0, database_factory_1.disconnectDatabase)();
    });
    it('should allow scanning a product and saving it as an inventory item', async () => {
        // Seed a product first
        const now = Date.now();
        const uniqueSuffix = Math.random().toString(36).slice(2, 10);
        const barcode = `SCAN-${now}-${uniqueSuffix}`;
        const product = await prisma.product.create({
            data: {
                barcode,
                name: 'Test Product',
                sku: `TEST-SKU-${now}-${uniqueSuffix}`,
                costPrice: 10.99,
            },
        });
        const storeArea = await prisma.storeArea.create({
            data: {
                name: `Scan Area ${now}-${uniqueSuffix}`,
                subDepartment: 'Test',
            },
        });
        const loginResponse = await (0, supertest_1.default)(index_1.default).post('/auth/login').send({ pin: '5624' });
        expect(loginResponse.status).toBe(200);
        const token = loginResponse.body.token;
        expect(token).toBeDefined();
        // Step 1: Scan a product (simulate by getting product by barcode)
        const getProductResponse = await (0, supertest_1.default)(index_1.default)
            .get(`/products/by-barcode/${barcode}`)
            .set('Authorization', `Bearer ${token}`);
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
        const postInventoryResponse = await (0, supertest_1.default)(index_1.default)
            .post('/inventory-items')
            .set('Authorization', `Bearer ${token}`)
            .send(newItem);
        expect(postInventoryResponse.status).toBe(201);
        expect(postInventoryResponse.body).toHaveProperty('id');
        expect(postInventoryResponse.body).toHaveProperty('productId', product.id);
    });
});

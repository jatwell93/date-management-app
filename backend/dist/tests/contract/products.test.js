"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../index"));
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
index_1.default.use(express_1.default.json());
describe('GET /products', () => {
    it('should respond with a 200 status code and product data for a valid barcode', async () => {
        // Using a known barcode from the seeded/mock data
        const barcode = '1234567890123';
        await prisma.product.create({
            data: {
                barcode,
                name: 'Contract Test Product',
                sku: 'CONTRACT-SKU-1',
                costPrice: 5.0,
            },
        });
        // Use the specific by-barcode endpoint as per route definition
        const response = await (0, supertest_1.default)(index_1.default).get(`/products/by-barcode/${barcode}`);
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('barcode', barcode);
    });
});
describe('POST /products/upload-csv', () => {
    it('should respond with a 200 status code and a success message for a valid CSV file', async () => {
        const csvFilePath = path_1.default.resolve(__dirname, 'test-products.csv');
        // Changed header from 'cost_price' (snake_case) to 'Cost' (allowed alternative in product.service.ts)
        // Also matched keys in the CSV content to the header logic
        const csvContent = 'Barcode,SKU,Name,Cost\n123,SKU123,Test Product,10.00';
        fs_1.default.writeFileSync(csvFilePath, csvContent);
        const response = await (0, supertest_1.default)(index_1.default).post('/products/upload-csv').attach('file', csvFilePath);
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'CSV processed successfully');
        fs_1.default.unlinkSync(csvFilePath); // Clean up the test file
    });
});
describe('POST /products', () => {
    it('should respond with a 201 status code and the created product', async () => {
        const uniqueId = Date.now().toString();
        const newProduct = {
            barcode: `987${uniqueId.substring(6)}`, // Ensure unique/valid length
            sku: `SKU987${uniqueId}`,
            name: 'New Product Name',
            costPrice: 15.0,
        };
        const response = await (0, supertest_1.default)(index_1.default).post('/products').send(newProduct);
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('name', newProduct.name);
    });
});

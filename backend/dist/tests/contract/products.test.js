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
index_1.default.use(express_1.default.json());
describe("GET /products", () => {
    it("should respond with a 200 status code and product data for a valid barcode", async () => {
        const barcode = "123456789";
        const response = await (0, supertest_1.default)(index_1.default).get(`/products?barcode=${barcode}`);
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("id");
        expect(response.body).toHaveProperty("barcode", barcode);
    });
});
describe("POST /products/upload-csv", () => {
    it("should respond with a 200 status code and a success message for a valid CSV file", async () => {
        const csvFilePath = path_1.default.resolve(__dirname, "test-products.csv");
        const csvContent = "barcode,sku,name,cost_price\n123,SKU123,Test Product,10.00";
        fs_1.default.writeFileSync(csvFilePath, csvContent);
        const response = await (0, supertest_1.default)(index_1.default)
            .post("/products/upload-csv")
            .attach("file", csvFilePath);
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("message", "Product data updated successfully.");
        fs_1.default.unlinkSync(csvFilePath); // Clean up the test file
    });
});
describe("POST /products", () => {
    it("should respond with a 201 status code and the created product", async () => {
        const newProduct = {
            barcode: "987654321",
            sku: "SKU987",
            name: "New Product Name",
            cost_price: 15.0,
        };
        const response = await (0, supertest_1.default)(index_1.default).post("/products").send(newProduct);
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("id");
        expect(response.body).toHaveProperty("name", newProduct.name);
    });
});

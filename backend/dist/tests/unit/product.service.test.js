"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const product_service_1 = require("../../services/product.service");
const database_1 = require("../../database");
jest.mock("../../database");
describe("ProductService", () => {
    let productService;
    const mockStatement = {
        run: jest.fn(),
        all: jest.fn(),
        get: jest.fn(),
    };
    const mockDb = {
        prepare: jest.fn(() => mockStatement),
    };
    beforeEach(() => {
        productService = new product_service_1.ProductService();
        database_1.getDb.mockReturnValue(mockDb);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("should return a product by barcode", async () => {
        const mockProduct = {
            id: 1,
            barcode: "123",
            sku: "SKU1",
            name: "Product 1",
            costPrice: 10,
            createdAt: "now",
            updatedAt: "now",
        };
        mockStatement.get.mockReturnValue(mockProduct);
        const product = await productService.getProductByBarcode("123");
        expect(product).toEqual(mockProduct);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM products WHERE barcode = ?");
        expect(mockStatement.get).toHaveBeenCalledWith("123");
    });
    it("should return null if product not found by barcode", async () => {
        mockStatement.get.mockReturnValue(undefined);
        const product = await productService.getProductByBarcode("non_existent");
        expect(product).toBeNull();
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM products WHERE barcode = ?");
        expect(mockStatement.get).toHaveBeenCalledWith("non_existent");
    });
    it("should create a new product", async () => {
        const newProductData = {
            barcode: "456",
            sku: "SKU2",
            name: "Product 2",
            costPrice: 20,
        };
        mockStatement.run.mockReturnValue({ lastInsertRowid: 2 });
        const createdProduct = await productService.createProduct(newProductData);
        expect(createdProduct).toEqual(expect.objectContaining({
            id: 2,
            ...newProductData,
        }));
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledWith("INSERT INTO products (barcode, sku, name, cost_price) VALUES (?, ?, ?, ?)");
        expect(mockStatement.run).toHaveBeenCalledWith("456", "SKU2", "Product 2", 20);
    });
});

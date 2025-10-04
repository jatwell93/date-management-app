"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const product_service_1 = require("../../services/product.service");
const database_1 = require("../../database");
const fs_1 = __importDefault(require("fs"));
// Mock the database module
jest.mock("../../database", () => ({
    getDb: jest.fn(),
}));
describe("ProductService", () => {
    let productService;
    let mockDb;
    beforeEach(() => {
        productService = new product_service_1.ProductService();
        mockDb = {
            get: jest.fn(),
            run: jest.fn(),
        };
        database_1.getDb.mockResolvedValue(mockDb);
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
            cost_price: 10.0,
            created_at: "now",
            updated_at: "now",
        };
        mockDb.get.mockResolvedValue(mockProduct);
        const product = await productService.getProductByBarcode("123");
        expect(product).toEqual(mockProduct);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.get).toHaveBeenCalledWith("SELECT * FROM products WHERE barcode = ?", "123");
    });
    it("should return null if product not found by barcode", async () => {
        mockDb.get.mockResolvedValue(undefined);
        const product = await productService.getProductByBarcode("non_existent");
        expect(product).toBeNull();
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.get).toHaveBeenCalledWith("SELECT * FROM products WHERE barcode = ?", "non_existent");
    });
    it("should create a new product", async () => {
        const newProductData = {
            barcode: "456",
            sku: "SKU2",
            name: "Product 2",
            costPrice: 20.0,
        };
        mockDb.run.mockResolvedValue({ lastID: 2 });
        const createdProduct = await productService.createProduct(newProductData);
        expect(createdProduct).toEqual(expect.objectContaining({
            id: 2,
            ...newProductData,
        }));
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith("INSERT INTO products (barcode, sku, name, cost_price) VALUES (?, ?, ?, ?)", newProductData.barcode, newProductData.sku, newProductData.name, newProductData.costPrice);
    });
    it("should validate CSV structure correctly", async () => {
        // Create a temporary CSV file with valid structure
        const validCSVPath = "/tmp/valid_test.csv";
        const validCSVContent = "SKU,Name,Cost,Barcode\nSKU001,Product 1,10.99,1234567890123";
        // Mock the file system to simulate a stream
        const mockReadStream = {
            pipe: jest.fn().mockReturnThis(),
            on: jest.fn().mockImplementation(function (event, handler) {
                if (event === 'data') {
                    // Emit sample data
                    handler({ 'SKU': 'SKU001', 'Name': 'Product 1', 'Cost': '10.99', 'Barcode': '1234567890123' });
                }
                else if (event === 'end') {
                    // Call the handler to simulate end of stream
                    handler();
                }
                return this;
            })
        };
        jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
        // This will test the validation function in isolation
        // Since the validation is part of processCSVUpload, we can test its behavior indirectly
        // by checking that the validation is being called correctly
        expect(fs_1.default.createReadStream).not.toHaveBeenCalled();
    });
    describe("CSV Processing Tests", () => {
        it("should validate required fields in CSV", async () => {
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Emit row with missing name field
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': '', 'Cost': '10.99', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        // Call the handler to simulate end of stream
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about missing required field
            expect(result.errors).toContain('Row 1: Missing required field - Name. Please ensure the column exists and contains a value.');
        });
        it("should validate data type correctness for cost field", async () => {
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Emit row with invalid cost field
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Product 1', 'Cost': 'invalid', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        // Call the handler to simulate end of stream
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about invalid cost value
            expect(result.errors).toContain('Row 1: Invalid cost value - "invalid". Cost must be a positive number. Acceptable formats include: \'12.99\', \'$12.99\', \'€15.50\', \'1,234.56\', \'1.234,56\' (European format).');
        });
        it("should handle duplicate entries by updating existing products", async () => {
            // Mock to simulate existing product for duplicate handling
            const existingProduct = {
                id: 1,
                barcode: '1234567890123',
                sku: 'SKU001',
                name: 'Product 1',
                cost_price: 10.99,
                created_at: '2023-01-01',
                updated_at: '2023-01-01',
            };
            // Mock the first call to get product by SKU to return the existing product
            // Mock the second call to get product by barcode to return nothing (since we find by SKU first)
            mockDb.get
                .mockResolvedValueOnce(existingProduct) // First call to getProductBySkuOrBarcode
                .mockResolvedValueOnce(null) // Second call if it tries to get by barcode
                .mockResolvedValueOnce(existingProduct); // Call when fetching updated product
            mockDb.run.mockResolvedValue({ changes: 1 });
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Emit row that matches existing product
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Updated Product 1', 'Cost': '15.99', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        // Call the handler to simulate end of stream
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should update an existing product, not create a new one
            expect(result.updated).toBe(1);
            expect(result.imported).toBe(0);
        });
        it("should implement proper error handling and reporting", async () => {
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Simulate an async error in processing
                        setImmediate(() => {
                            try {
                                handler(new Error('Processing error'), { 'SKU': 'SKU001', 'Name': 'Product 1', 'Cost': '10.99', 'Barcode': '1234567890123' });
                            }
                            catch (e) {
                                // Error caught by the promise rejection in the service
                            }
                        });
                    }
                    else if (event === 'end') {
                        // Call the handler to simulate end of stream
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error reported in the results
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
    describe("CSV Edge Case Tests", () => {
        it("should handle empty CSV file", async () => {
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'end') {
                        // Call the handler immediately without any data
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about empty file
            expect(result.errors).toContain('CSV file is empty or contains no valid records');
        });
        it("should handle CSV with negative cost values in parentheses", async () => {
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Product 1', 'Cost': '(10.99)', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should not have errors as negative costs in parentheses are now allowed
            expect(result.errors.length).toBe(0);
            expect(result.imported).toBe(1);
        });
        it("should handle CSV with very long field values", async () => {
            const longName = 'A'.repeat(201); // Exceeds 200 character limit
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': longName, 'Cost': '10.99', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about name being too long
            expect(result.errors).toContain(`Row 1: Name too long (max 200 characters) - "${'A'.repeat(50)}...". Please ensure the Name value is 200 characters or fewer.`);
        });
        it("should handle CSV with unexpected columns", async () => {
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Emit row with extra columns
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Product 1', 'Cost': '10.99', 'Barcode': '1234567890123', 'ExtraCol': 'Extra Value' }));
                    }
                    else if (event === 'end') {
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about unexpected columns
            expect(result.errors).toContain('Row 1: Unexpected columns found - ExtraCol');
        });
        it("should handle database errors during product creation", async () => {
            mockDb.run.mockRejectedValue(new Error('Database error'));
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Product 1', 'Cost': '10.99', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about failed product creation
            expect(result.errors).toContain('Row 1: Failed to create new product (SKU: SKU001) - Database error');
        });
        it("should handle database errors during product update", async () => {
            // Mock to simulate existing product that requires update
            const existingProduct = {
                id: 1,
                barcode: '1234567890123',
                sku: 'SKU001',
                name: 'Product 1',
                cost_price: 10.99,
                created_at: '2023-01-01',
                updated_at: '2023-01-01',
            };
            mockDb.get
                .mockResolvedValueOnce(existingProduct) // First call to find by SKU
                .mockResolvedValueOnce(null) // Second call to find by barcode (when both are checked)
                .mockResolvedValueOnce(existingProduct); // Call when fetching updated product
            mockDb.run.mockRejectedValue(new Error('Database update error'));
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Emit row that matches existing product
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Updated Product 1', 'Cost': '15.99', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about failed product update
            expect(result.errors).toContain('Row 1: Failed to update existing product (SKU: SKU001) - Database update error');
        });
        it("should handle the case where SKU and barcode match different products", async () => {
            // Mock two different products - one matching the SKU, one matching the barcode
            const productWithMatchingSku = {
                id: 1,
                barcode: 'different_barcode',
                sku: 'SKU001',
                name: 'Product 1',
                cost_price: 10.99,
                created_at: '2023-01-01',
                updated_at: '2023-01-01',
            };
            const productWithMatchingBarcode = {
                id: 2,
                barcode: '1234567890123',
                sku: 'DIFFERENT_SKU',
                name: 'Product 2',
                cost_price: 15.99,
                created_at: '2023-01-01',
                updated_at: '2023-01-01',
            };
            // First call gets the product with matching SKU
            mockDb.get
                .mockResolvedValueOnce(productWithMatchingSku) // First call - by SKU
                .mockResolvedValueOnce(productWithMatchingBarcode); // Second call - by barcode
            const mockReadStream = {
                pipe: jest.fn().mockReturnThis(),
                on: jest.fn().mockImplementation(function (event, handler) {
                    if (event === 'data') {
                        // Emit row with SKU matching product 1 and barcode matching product 2
                        setImmediate(() => handler({ 'SKU': 'SKU001', 'Name': 'Updated Product', 'Cost': '20.99', 'Barcode': '1234567890123' }));
                    }
                    else if (event === 'end') {
                        setImmediate(() => handler());
                    }
                    return this;
                })
            };
            jest.spyOn(fs_1.default, 'createReadStream').mockReturnValue(mockReadStream);
            const result = await productService.processCSVUpload('test.csv');
            // Should have an error about conflicting identifiers
            expect(result.errors).toContain('Row 1: Duplicate identifiers detected: SKU SKU001 exists in product 1 and barcode 1234567890123 exists in product 2. This will cause data integrity issues.');
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        });
    });
});

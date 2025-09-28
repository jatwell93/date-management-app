"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductService = void 0;
const database_1 = require("../database");
class ProductService {
    async getAllProducts() {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM products");
    }
    async getProductById(id) {
        const db = await (0, database_1.getDb)();
        const product = await db.get("SELECT * FROM products WHERE id = ?", id);
        return product || null;
    }
    async getProductByBarcode(barcode) {
        const db = await (0, database_1.getDb)();
        const product = await db.get("SELECT * FROM products WHERE barcode = ?", barcode);
        return product || null;
    }
    async createProduct(product) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("INSERT INTO products (barcode, sku, name, cost_price) VALUES (?, ?, ?, ?)", product.barcode, product.sku, product.name, product.costPrice);
        const newProduct = {
            id: result.lastID,
            ...product,
            createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
            updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
        };
        return newProduct;
    }
    async updateProduct(id, product) {
        const db = await (0, database_1.getDb)();
        const fields = Object.keys(product);
        if (fields.length === 0) {
            return null;
        }
        const setClause = fields.map((field) => `${field} = ?`).join(", ");
        const values = [...Object.values(product), id];
        const result = await db.run(`UPDATE products SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...values);
        if ((result.changes ?? 0) === 0) {
            return null;
        }
        // Return the updated product
        const updatedProduct = await this.getProductById(id);
        return updatedProduct;
    }
    async deleteProduct(id) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("DELETE FROM products WHERE id = ?", id);
        return (result.changes ?? 0) > 0;
    }
}
exports.ProductService = ProductService;

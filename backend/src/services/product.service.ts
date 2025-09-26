import { getDb } from "../database";
import { Product } from "../models/product.model";

export class ProductService {
  async getAllProducts(): Promise<Product[]> {
    const db = await getDb();
    return db.all("SELECT * FROM products");
  }

  async getProductById(id: number): Promise<Product | null> {
    const db = await getDb();
    const product: Product | undefined = await db.get(
      "SELECT * FROM products WHERE id = ?",
      id,
    );
    return product || null;
  }

  async getProductByBarcode(barcode: string): Promise<Product | null> {
    const db = await getDb();
    const product: Product | undefined = await db.get(
      "SELECT * FROM products WHERE barcode = ?",
      barcode,
    );
    return product || null;
  }

  async createProduct(
    product: Omit<Product, "id" | "createdAt" | "updatedAt">,
  ): Promise<Product> {
    const db = await getDb();
    const result = await db.run(
      "INSERT INTO products (barcode, sku, name, cost_price) VALUES (?, ?, ?, ?)",
      product.barcode,
      product.sku,
      product.name,
      product.costPrice,
    );
    const newProduct: Product = {
      id: result.lastID!,
      ...product,
      createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
      updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
    };
    return newProduct;
  }

  async updateProduct(
    id: number,
    product: Partial<Omit<Product, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Product | null> {
    const db = await getDb();
    const fields = Object.keys(product);

    if (fields.length === 0) {
      return null;
    }

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = [...Object.values(product), id];

    const result = await db.run(
      `UPDATE products SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ...values,
    );

    if (result.changes === 0) {
      return null;
    }

    // Return the updated product
    const updatedProduct = await this.getProductById(id);
    return updatedProduct;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const db = await getDb();
    const result = await db.run("DELETE FROM products WHERE id = ?", id);
    return result.changes > 0;
  }
}

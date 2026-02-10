/**
 * Product data model
 * Represents a unique product in the inventory system
 */

export interface Product {
  id: number;
  organizationId: string;
  barcode: string;
  sku: string;
  name: string;
  costPrice: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deprecated: ProductModel uses legacy sqlite3 approach
 * Use Prisma services (ProductService, etc.) instead
 */

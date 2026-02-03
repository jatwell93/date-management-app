/**
 * Workers Database Client
 * 
 * Uses Neon's edge-native serverless driver for Cloudflare Workers.
 * This is purpose-built for edge environments - no Prisma, no native bindings.
 * 
 * Uses Hyperdrive for edge-pooled connections to Neon PostgreSQL.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';

// Note: fetchConnectionCache is now always true by default in @neondatabase/serverless

/**
 * Database wrapper providing typed query methods
 */
export interface Database {
  sql: NeonQueryFunction<false, false>;
  
  // User queries
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: number): Promise<User | null>;
  createUser(data: CreateUserData): Promise<User>;
  
  // Product queries
  findProducts(options?: { limit?: number; offset?: number; search?: string }): Promise<Product[]>;
  findProductById(id: number): Promise<Product | null>;
  countProducts(search?: string): Promise<number>;
  
  // Inventory queries
  findInventoryItems(options?: { limit?: number; offset?: number }): Promise<InventoryItem[]>;
  countInventoryItems(): Promise<number>;
  
  // Store area queries
  findStoreAreas(): Promise<StoreArea[]>;
  
  // Dashboard queries
  getDashboardStats(): Promise<DashboardStats>;
}

// Type definitions matching backend Prisma schema
export interface User {
  id: number;
  email: string;
  name: string | null;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  name?: string;
  passwordHash: string;
  role?: string;
}

export interface Product {
  id: number;
  name: string;
  barcode: string | null;
  description: string | null;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryItem {
  id: number;
  productId: number;
  quantity: number;
  expiryDate: Date | null;
  storeAreaId: number | null;
  createdAt: Date;
  updatedAt: Date;
  product?: Product;
  storeArea?: StoreArea;
}

export interface StoreArea {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardStats {
  totalProducts: number;
  totalInventoryItems: number;
  expiringItems: number;
  lowStockItems: number;
}

/**
 * Create database connection for Workers environment
 * Uses Hyperdrive connection string from env bindings
 */
export function createWorkersDatabase(env: Env): Database {
  // Get connection string - prefer Hyperdrive for edge pooling
  let connectionString = env.HYPERDRIVE?.connectionString;
  
  if (!connectionString) {
    console.warn('[Database] No Hyperdrive connection, using fallback');
    connectionString = env.DATABASE_URL || env.NEON_CONNECTION_STRING;
  } else {
    console.log('[Database] Connecting via Cloudflare Hyperdrive (edge pooling)');
  }
  
  if (!connectionString) {
    throw new Error('No database connection string available. Configure HYPERDRIVE or DATABASE_URL.');
  }

  // Create Neon SQL tagged template function
  const sql = neon(connectionString);

  return {
    sql,

    // User queries
    async findUserByEmail(email: string): Promise<User | null> {
      const rows = await sql`
        SELECT id, email, name, password_hash as "passwordHash", role, 
               created_at as "createdAt", updated_at as "updatedAt"
        FROM users 
        WHERE LOWER(email) = LOWER(${email})
        LIMIT 1
      `;
      return rows[0] as User || null;
    },

    async findUserById(id: number): Promise<User | null> {
      const rows = await sql`
        SELECT id, email, name, password_hash as "passwordHash", role,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM users 
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] as User || null;
    },

    async createUser(data: CreateUserData): Promise<User> {
      const rows = await sql`
        INSERT INTO users (email, name, password_hash, role, created_at, updated_at)
        VALUES (${data.email.toLowerCase()}, ${data.name || null}, ${data.passwordHash}, ${data.role || 'user'}, NOW(), NOW())
        RETURNING id, email, name, password_hash as "passwordHash", role, 
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0] as User;
    },

    // Product queries
    async findProducts(options?: { limit?: number; offset?: number; search?: string }): Promise<Product[]> {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const search = options?.search;

      if (search) {
        const searchPattern = `%${search}%`;
        return await sql`
          SELECT id, name, barcode, description, category,
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM products
          WHERE name ILIKE ${searchPattern} OR barcode ILIKE ${searchPattern}
          ORDER BY name ASC
          LIMIT ${limit} OFFSET ${offset}
        ` as Product[];
      }

      return await sql`
        SELECT id, name, barcode, description, category,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        ORDER BY name ASC
        LIMIT ${limit} OFFSET ${offset}
      ` as Product[];
    },

    async findProductById(id: number): Promise<Product | null> {
      const rows = await sql`
        SELECT id, name, barcode, description, category,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] as Product || null;
    },

    async countProducts(search?: string): Promise<number> {
      if (search) {
        const searchPattern = `%${search}%`;
        const rows = await sql`
          SELECT COUNT(*)::int as count FROM products
          WHERE name ILIKE ${searchPattern} OR barcode ILIKE ${searchPattern}
        `;
        return rows[0]?.count || 0;
      }
      const rows = await sql`SELECT COUNT(*)::int as count FROM products`;
      return rows[0]?.count || 0;
    },

    // Inventory queries  
    async findInventoryItems(options?: { limit?: number; offset?: number }): Promise<InventoryItem[]> {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;

      return await sql`
        SELECT 
          i.id, i.product_id as "productId", i.quantity, 
          i.expiry_date as "expiryDate", i.store_area_id as "storeAreaId",
          i.created_at as "createdAt", i.updated_at as "updatedAt",
          json_build_object(
            'id', p.id, 'name', p.name, 'barcode', p.barcode, 'category', p.category
          ) as product,
          CASE WHEN s.id IS NOT NULL THEN 
            json_build_object('id', s.id, 'name', s.name)
          ELSE NULL END as "storeArea"
        FROM inventory_items i
        LEFT JOIN products p ON i.product_id = p.id
        LEFT JOIN store_areas s ON i.store_area_id = s.id
        ORDER BY i.expiry_date ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      ` as InventoryItem[];
    },

    async countInventoryItems(): Promise<number> {
      const rows = await sql`SELECT COUNT(*)::int as count FROM inventory_items`;
      return rows[0]?.count || 0;
    },

    // Store area queries
    async findStoreAreas(): Promise<StoreArea[]> {
      return await sql`
        SELECT id, name, description,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM store_areas
        ORDER BY name ASC
      ` as StoreArea[];
    },

    // Dashboard queries
    async getDashboardStats(): Promise<DashboardStats> {
      const [products, inventory, expiring, lowStock] = await Promise.all([
        sql`SELECT COUNT(*)::int as count FROM products`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items 
            WHERE expiry_date IS NOT NULL AND expiry_date <= NOW() + INTERVAL '7 days'`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items WHERE quantity <= 5`,
      ]);

      return {
        totalProducts: products[0]?.count || 0,
        totalInventoryItems: inventory[0]?.count || 0,
        expiringItems: expiring[0]?.count || 0,
        lowStockItems: lowStock[0]?.count || 0,
      };
    },
  };
}
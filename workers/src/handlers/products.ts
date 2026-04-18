/**
 * Products Handler - Multi-Tenant Safe
 *
 * All queries filter by organizationId using parameterized template literals
 * to prevent SQL injection and ensure multi-tenant data isolation.
 *
 * All database operations include automatic retry logic for transient failures.
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { withNeonRetry } from '../utils/db-retry';

export interface Product {
  id: number;
  name: string;
  barcode: string | null;
  description: string | null;
  category: string | null;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

export async function getProducts(env: Env, organizationId: string): Promise<Product[]> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT id, name, barcode, description, category, organization_id, 
             created_at, updated_at
      FROM products
      WHERE organization_id = ${organizationId}
      ORDER BY name ASC
    `;
    return results as Product[];
  });
}

export async function getProductById(
  env: Env,
  organizationId: string,
  productId: number,
): Promise<Product | null> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT id, name, barcode, description, category, organization_id,
             created_at, updated_at
      FROM products
      WHERE id = ${productId} AND organization_id = ${organizationId}
    `;
    return (results[0] as Product) || null;
  });
}

export async function getProductByBarcode(
  env: Env,
  organizationId: string,
  barcode: string,
): Promise<Product | null> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT id, name, barcode, description, category, organization_id,
             created_at, updated_at
      FROM products
      WHERE barcode = ${barcode} AND organization_id = ${organizationId}
    `;
    return (results[0] as Product) || null;
  });
}

export async function countProducts(env: Env, organizationId: string): Promise<number> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT COUNT(*) as count FROM products
      WHERE organization_id = ${organizationId}
    `;
    return ((results[0] as any).count as number) ?? 0;
  });
}

export async function createProduct(
  env: Env,
  organizationId: string,
  productData: {
    name: string;
    barcode?: string;
    description?: string;
    category?: string;
  },
): Promise<Product> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = (await sql`
      INSERT INTO products (
        name, barcode, description, category, organization_id, created_at, updated_at
      ) VALUES (
        ${productData.name},
        ${productData.barcode || null},
        ${productData.description || null},
        ${productData.category || null},
        ${organizationId},
        NOW(),
        NOW()
      )
      RETURNING id, name, barcode, description, category, organization_id,
                created_at, updated_at
    `) as Product[];

    if (!results[0]) throw new Error('Failed to create product');
    return results[0];
  });
}

export async function deleteProduct(
  env: Env,
  organizationId: string,
  productId: number,
): Promise<boolean> {
  return withNeonRetry(async () => {
    // Verify ownership first
    const existing = await getProductById(env, organizationId, productId);
    if (!existing) return false;

    const sql = neon(getConnectionString(env));
    const results = await sql`
      DELETE FROM products
      WHERE id = ${productId} AND organization_id = ${organizationId}
      RETURNING id
    `;
    return (results as any[]).length > 0;
  });
}

function getConnectionString(env: Env): string {
  return env.HYPERDRIVE?.connectionString || env.NEON_CONNECTION_STRING || '';
}

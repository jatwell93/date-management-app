/**
 * Inventory Handler - Multi-Tenant Safe
 *
 * All queries filter by organizationId through product relationship
 * to prevent SQL injection and ensure multi-tenant data isolation
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { getConnectionString } from '../utils/db-connection';

export interface InventoryItem {
  id: number;
  product_id: number;
  quantity: number;
  expiry_date: Date | null;
  store_area_id: number | null;
  status: string;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

export async function getInventoryItems(
  env: Env,
  organizationId: string,
): Promise<InventoryItem[]> {
  const sql = neon(getConnectionString(env));
  const results = await sql`
    SELECT i.id, i.product_id, i.quantity, i.expiry_date, i.store_area_id,
           i.status, p.organization_id, i.created_at, i.updated_at
    FROM inventory_items i
    JOIN products p ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
    ORDER BY i.created_at DESC
  `;
  return results as InventoryItem[];
}

export async function getInventoryItemById(
  env: Env,
  organizationId: string,
  itemId: number,
): Promise<InventoryItem | null> {
  const sql = neon(getConnectionString(env));
  const results = await sql`
    SELECT i.id, i.product_id, i.quantity, i.expiry_date, i.store_area_id,
           i.status, p.organization_id, i.created_at, i.updated_at
    FROM inventory_items i
    JOIN products p ON i.product_id = p.id
    WHERE i.id = ${itemId} AND p.organization_id = ${organizationId}
  `;
  return (results[0] as InventoryItem) || null;
}

export async function getExpiringItems(
  env: Env,
  organizationId: string,
  daysUntilExpiry: number = 90,
): Promise<InventoryItem[]> {
  const sql = neon(getConnectionString(env));
  const results = await sql`
    SELECT i.id, i.product_id, i.quantity, i.expiry_date, i.store_area_id,
           i.status, p.organization_id, i.created_at, i.updated_at
    FROM inventory_items i
    JOIN products p ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
      AND i.expiry_date IS NOT NULL
      AND i.expiry_date <= CURRENT_DATE + INTERVAL '1 day' * ${daysUntilExpiry}
      AND i.expiry_date > CURRENT_DATE
    ORDER BY i.expiry_date ASC
  `;
  return results as InventoryItem[];
}

export async function countInventoryItems(env: Env, organizationId: string): Promise<number> {
  const sql = neon(getConnectionString(env));
  const results = await sql`
    SELECT COUNT(*) as count
    FROM inventory_items i
    JOIN products p ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
  `;
  return ((results[0] as any).count as number) ?? 0;
}

export async function createInventoryItem(
  env: Env,
  organizationId: string,
  itemData: {
    productId: number;
    quantity: number;
    expiryDate?: string;
    storeAreaId?: number;
  },
): Promise<InventoryItem> {
  // First verify product belongs to organization
  const sql = neon(getConnectionString(env));
  const prodCheck = await sql`
    SELECT id FROM products WHERE id = ${itemData.productId} AND organization_id = ${organizationId}
  `;
  if (!prodCheck[0]) throw new Error('Product not found or does not belong to organization');

  const results = (await sql`
    INSERT INTO inventory_items (
      product_id, quantity, expiry_date, store_area_id, status, created_at, updated_at
    ) VALUES (
      ${itemData.productId},
      ${itemData.quantity},
      ${itemData.expiryDate || null},
      ${itemData.storeAreaId || null},
      'Normal',
      NOW(),
      NOW()
    )
    RETURNING id, product_id, quantity, expiry_date, store_area_id, status,
              created_at, updated_at
  `) as any[];

  if (!results[0]) throw new Error('Failed to create inventory item');
  return {
    ...results[0],
    organization_id: organizationId,
  } as InventoryItem;
}

export async function deleteInventoryItem(
  env: Env,
  organizationId: string,
  itemId: number,
): Promise<boolean> {
  const existing = await getInventoryItemById(env, organizationId, itemId);
  if (!existing) return false;

  const sql = neon(getConnectionString(env));
  const results = await sql`
    DELETE FROM inventory_items WHERE id = ${itemId} RETURNING id
  `;
  return results.length > 0;
}

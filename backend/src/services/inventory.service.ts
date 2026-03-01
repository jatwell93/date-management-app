import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { InventoryItem } from '../models/inventory-item.model';
import { ItemTransaction } from '../models/item-transaction.model';
import { getOrganizationId } from '../utils/auth-bypass';

export interface CreateInventoryItemInput {
  productId: number;
  expiryDate: string;
  locationId: number;
  status?: InventoryItem['status'];
}

export class InventoryService {
  private prisma: PrismaClient;
  private organizationId: string;

  // Markdown thresholds in days
  private static readonly MARKDOWN_THRESHOLDS = {
    markdown3: 7, // Within 1 week: cost price - 20%
    markdown2: 14, // Within 2 weeks: cost price
    markdown1: 30, // Within 1 month: cost price + 20%
  } as const;

  /**
   * Constructor with optional dependency injection
   * @param organizationId - Organization ID for tenant isolation (optional in tests)
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   */
  constructor(organizationId?: string, prismaClient?: PrismaClient) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  /**
   * Get all inventory items
   */
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        organizationId: this.organizationId,
      },
    });
    return items.map(this.mapPrismaToModel);
  }

  /**
   * Get an inventory item by its ID
   */
  async getInventoryItemById(id: number): Promise<InventoryItem | null> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        id,
        organizationId: this.organizationId,
      },
    });
    return item ? this.mapPrismaToModel(item) : null;
  }

  /**
   * Get all inventory items for a specific product
   */
  async getInventoryItemsByProductId(productId: number): Promise<InventoryItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        productId,
        organizationId: this.organizationId,
      },
    });
    return items.map(this.mapPrismaToModel);
  }

  /**
   * Get recent inventory items for a specific product
   */
  async getRecentInventoryItemsByProductId(
    productId: number,
    limit: number,
  ): Promise<InventoryItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        productId,
        organizationId: this.organizationId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map(this.mapPrismaToModel);
  }

  /**
   * Get all inventory items for a specific location
   */
  async getInventoryItemsByLocationId(locationId: number): Promise<InventoryItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        locationId,
        organizationId: this.organizationId,
      },
    });
    return items.map(this.mapPrismaToModel);
  }

  /**
   * Create a new inventory item
   */
  async createInventoryItem(
    item: CreateInventoryItemInput,
    userId: number,
  ): Promise<InventoryItem> {
    const { productId, expiryDate, locationId } = item;

    const result = await this.prisma.$transaction(async (tx) => {
      // Validate that the product and location belong to the organization
      await this.validateProductOwnership(productId, tx);
      await this.validateLocationOwnership(locationId, tx);

      // Check usage limits before creating the item
      const currentUsage = await tx.organizationUsage.findUnique({
        where: { organizationId: this.organizationId },
        select: { totalInventoryItems: true, maxInventoryItems: true },
      });

      if (currentUsage && currentUsage.maxInventoryItems !== null) {
        if (currentUsage.totalInventoryItems >= currentUsage.maxInventoryItems) {
          throw new Error(
            `Cannot create inventory item: maximum limit of ${currentUsage.maxInventoryItems} inventory items reached. ` +
              `Current usage: ${currentUsage.totalInventoryItems}.`,
          );
        }
      }

      // Calculate markdown status
      const calculatedStatus: 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' =
        item.status || (await this.calculateMarkdownStatus(item.expiryDate));

      const newItem = await tx.inventoryItem.create({
        data: {
          organizationId: this.organizationId,
          productId,
          expiryDate: new Date(expiryDate), // Convert string to Date for Prisma
          locationId,
          status: calculatedStatus,
        },
      });

      // Increment organization usage counter atomically
      await tx.organizationUsage.update({
        where: { organizationId: this.organizationId },
        data: {
          totalInventoryItems: { increment: 1 },
        },
      });

      // Create audit log entry
      const changeDescription = `Inventory item created with expiry date ${expiryDate} and status ${calculatedStatus}.`;
      await this.createAuditLogInTransaction(tx, userId, newItem.id, changeDescription);

      return newItem;
    });

    return this.mapPrismaToModel(result);
  }

  /**
   * Validate resource belongs to organization
   */
  private async validateResourceOwnership(
    resourceType: 'product' | 'storeArea',
    resourceId: number,
    client: PrismaClient | any,
  ): Promise<void> {
    const resource = await client[resourceType].findFirst({
      where: {
        id: resourceId,
        organizationId: this.organizationId,
      },
    });
    if (!resource) {
      const resourceTypeName = resourceType === 'storeArea' ? 'Location' : 'Product';
      throw new Error(`${resourceTypeName} not found or does not belong to this organization`);
    }
  }

  /**
   * Validate product belongs to organization
   */
  private async validateProductOwnership(
    productId: number,
    client: PrismaClient | any,
  ): Promise<void> {
    await this.validateResourceOwnership('product', productId, client);
  }

  /**
   * Validate location belongs to organization
   */
  private async validateLocationOwnership(
    locationId: number,
    client: PrismaClient | any,
  ): Promise<void> {
    await this.validateResourceOwnership('storeArea', locationId, client);
  }

  /**
   * Handle Prisma errors consistently
   */
  private handlePrismaError(error: unknown): null {
    if (error && typeof error === 'object' && (error as any).code === 'P2025') {
      return null;
    }
    throw error;
  }

  /**
   * Update an existing inventory item
   */
  async updateInventoryItem(
    id: number,
    updates: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>,
    userId: number,
  ): Promise<InventoryItem | null> {
    if (Object.keys(updates).length === 0) {
      // No updates to perform - still need to check if item exists
      const existingItem = await this.getInventoryItemById(id);
      return existingItem;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Get the item within transaction to ensure it still exists
        const existingItem = await tx.inventoryItem.findFirst({
          where: {
            id,
            organizationId: this.organizationId,
          },
        });
        if (!existingItem) {
          return null;
        }

        // Validate relationships if being updated
        if (updates.productId !== undefined) {
          await this.validateProductOwnership(updates.productId, tx);
        }
        if (updates.locationId !== undefined) {
          await this.validateLocationOwnership(updates.locationId, tx);
        }

        // If expiry date is updated, recalculate markdown status
        let statusUpdate = updates.status;
        if (updates.expiryDate) {
          statusUpdate = await this.calculateMarkdownStatus(updates.expiryDate);
        }

        const updatedItem = await tx.inventoryItem.update({
          where: { id },
          data: {
            ...(updates.productId !== undefined && { productId: updates.productId }),
            ...(updates.expiryDate !== undefined && { expiryDate: new Date(updates.expiryDate) }),
            ...(updates.locationId !== undefined && { locationId: updates.locationId }),
            ...(statusUpdate !== undefined && { status: statusUpdate }),
          },
        });

        // Create audit log entry within transaction
        const changeDescription = this.formatChangeDescription(updates);
        await this.createAuditLogInTransaction(tx, userId, id, changeDescription);

        return updatedItem;
      });

      return result ? this.mapPrismaToModel(result) : null;
    } catch (error: unknown) {
      return this.handlePrismaError(error);
    }
  }

  /**
   * Delete an inventory item
   */
  async deleteInventoryItem(id: number, userId: number): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Get the item before deleting to use in audit log
        const item = await tx.inventoryItem.findFirst({
          where: {
            id,
            organizationId: this.organizationId,
          },
        });
        if (!item) {
          throw new Error('Inventory item not found');
        }

        // Create audit log entry before deleting the item
        const changeDescription = `Inventory item with ID ${id} deleted.`;
        await this.createAuditLogInTransaction(tx, userId, id, changeDescription);

        // Delete the inventory item
        await tx.inventoryItem.delete({
          where: { id },
        });

        // Decrement organization usage counter, but prevent negative values
        await this.decrementInventoryCount(tx);
      });

      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Inventory item not found') {
        return false;
      }
      return this.handlePrismaError(error) === null ? false : true;
    }
  }

  /**
   * Decrement inventory count with validation
   */
  private async decrementInventoryCount(client: PrismaClient | any): Promise<void> {
    const currentUsage = await client.organizationUsage.findUnique({
      where: { organizationId: this.organizationId },
      select: { totalInventoryItems: true },
    });

    if (currentUsage && currentUsage.totalInventoryItems > 0) {
      await client.organizationUsage.update({
        where: { organizationId: this.organizationId },
        data: {
          totalInventoryItems: { decrement: 1 },
        },
      });
    } else if (currentUsage && currentUsage.totalInventoryItems === 0) {
      // Log warning about counter inconsistency
      console.warn(
        `Attempted to decrement totalInventoryItems for organization ${this.organizationId} but counter is already 0. ` +
          'This may indicate data inconsistency.',
      );
    }
  }

  /**
   * Synchronous version of calculateMarkdownStatus for use in batch operations
   */
  calculateMarkdownStatusSync(
    expiryDate: string,
  ): 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' {
    return this.calculateMarkdownStatusInternal(expiryDate);
  }

  /**
   * Internal shared implementation for markdown calculations
   */
  private calculateMarkdownStatusInternal(
    expiryDate: string,
  ): 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' {
    if (!expiryDate) {
      return 'Normal';
    }

    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysDiff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 0) {
      return 'Expired';
    }

    // Apply markdown rules based on days difference (from feature requirements)
    // Note: These are simple examples. Real logic might be more complex.
    if (daysDiff <= InventoryService.MARKDOWN_THRESHOLDS.markdown3) {
      // Within 1 week from expiry: cost price - 20% (Markdown 3)
      return 'Markdown 3';
    } else if (daysDiff <= InventoryService.MARKDOWN_THRESHOLDS.markdown2) {
      // Within 2 weeks from expiry: cost price (Markdown 2)
      return 'Markdown 2';
    } else if (daysDiff <= InventoryService.MARKDOWN_THRESHOLDS.markdown1) {
      // Within 1 month from expiry: cost price + 20% (Markdown 1)
      return 'Markdown 1';
    } else {
      // More than 1 month from expiry: Normal (no markdown)
      return 'Normal';
    }
  }

  /**
   * FR-003: Implement logic for automated markdown calculations
   */
  async autoCalculateMarkdownStatus(itemId: number, expiryDate: string): Promise<void> {
    // First verify the item belongs to this organization
    const item = await this.getInventoryItemById(itemId);
    if (!item) {
      throw new Error('Inventory item not found or does not belong to this organization');
    }

    const status = this.calculateMarkdownStatusInternal(expiryDate);

    // Update the inventory item's status in the database
    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { status },
    });
  }

  /**
   * Calculate markdown status based on expiry date without updating the database
   */
  async calculateMarkdownStatus(
    expiryDate: string,
  ): Promise<'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired'> {
    return this.calculateMarkdownStatusInternal(expiryDate);
  }

  /**
   * Format change description for audit logs
   */
  private formatChangeDescription(
    updates: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>,
  ): string {
    const changes: string[] = [];

    if (updates.productId !== undefined) {
      changes.push(`product changed to ID ${updates.productId}`);
    }
    if (updates.expiryDate !== undefined) {
      changes.push(`expiry date changed to ${updates.expiryDate}`);
    }
    if (updates.locationId !== undefined) {
      changes.push(`location changed to ID ${updates.locationId}`);
    }
    if (updates.status !== undefined) {
      changes.push(`status changed to ${updates.status}`);
    }

    return changes.length > 0
      ? `Inventory item updated: ${changes.join(', ')}`
      : 'Inventory item updated (no changes detected)';
  }

  /**
   * Create an audit log entry (base method that works with any Prisma client)
   */
  private async createAuditLogBase(
    client: PrismaClient | any,
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<void> {
    // Validate that the user belongs to the organization
    const user = await client.user.findFirst({
      where: {
        id: userId,
        organizationId: this.organizationId,
      },
    });
    if (!user) {
      throw new Error('User not found or does not belong to this organization');
    }

    await client.auditLog.create({
      data: {
        organizationId: this.organizationId,
        userId,
        inventoryItemId,
        action: 'inventory_changed',
        changeDescription,
      },
    });
  }

  /**
   * Create an audit log entry
   */
  private async createAuditLog(
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<void> {
    await this.createAuditLogBase(this.prisma, userId, inventoryItemId, changeDescription);
  }

  /**
   * Create an audit log entry within a transaction
   */
  private async createAuditLogInTransaction(
    tx: any,
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<void> {
    await this.createAuditLogBase(tx, userId, inventoryItemId, changeDescription);
  }

  /**
   * Log an item transaction
   */
  async logTransaction(
    transaction: Omit<ItemTransaction, 'id' | 'transactionDate'>,
  ): Promise<number> {
    const { inventory_item_id, user_id, type, quantity_change, notes } = transaction;

    // Validate that the inventory item belongs to the organization
    const item = await this.getInventoryItemById(inventory_item_id);
    if (!item) {
      throw new Error('Inventory item not found or does not belong to this organization');
    }

    // Validate that the user belongs to the organization
    const user = await this.prisma.user.findFirst({
      where: {
        id: user_id,
        organizationId: this.organizationId,
      },
    });
    if (!user) {
      throw new Error('User not found or does not belong to this organization');
    }

    const result = await this.prisma.itemTransaction.create({
      data: {
        organizationId: this.organizationId,
        inventoryItemId: inventory_item_id,
        userId: user_id,
        type,
        quantityChange: quantity_change,
        notes,
      },
    });

    return result.id;
  }

  /**
   * Map Prisma model to legacy InventoryItem interface
   */
  private mapPrismaToModel(item: {
    id: number;
    organizationId?: string | null;
    productId: number;
    expiryDate: Date;
    locationId: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): InventoryItem {
    return {
      id: item.id,
      organizationId: item.organizationId ?? this.organizationId,
      productId: item.productId,
      expiryDate: item.expiryDate.toISOString().split('T')[0], // Convert Date to YYYY-MM-DD string
      locationId: item.locationId,
      status: item.status as 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /**
   * Bulk update markdown statuses for multiple inventory items
   * Optimized for scheduler performance - reduces database round trips
   */
  async bulkUpdateMarkdownStatuses(
    items: Array<{ id: number; expiryDate: string }>,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    // Process in batches to avoid overwhelming the database
    const batchSize = 100;
    const batches = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    console.log(`Processing ${items.length} items in ${batches.length} batches...`);

    for (const batch of batches) {
      try {
        // Prepare bulk update operations
        const updateOperations = batch.map((item) => {
          const status = this.calculateMarkdownStatusInternal(item.expiryDate);
          return {
            where: {
              id: item.id,
              organizationId: this.organizationId, // Ensure tenant isolation
            },
            data: { status },
          };
        });

        // Execute all updates in a transaction for consistency
        await this.prisma.$transaction(async (tx) => {
          // Verify all items belong to this organization before updating
          const itemIds = batch.map((item) => item.id);
          const existingItems = await tx.inventoryItem.findMany({
            where: {
              id: { in: itemIds },
              organizationId: this.organizationId,
            },
            select: { id: true },
          });

          const existingItemIds = new Set(existingItems.map((item) => item.id));

          // Filter out updates for items that don't exist or don't belong to org
          const validUpdates = updateOperations.filter((op) => existingItemIds.has(op.where.id));

          if (validUpdates.length === 0) {
            console.warn(`No valid items found in batch for organization ${this.organizationId}`);
            return;
          }

          // Execute bulk update using raw SQL for better performance
          const updateCases = validUpdates
            .map((op, index) => `WHEN ${op.where.id} THEN '${op.data.status}'`)
            .join(' ');

          const itemIdsToUpdate = validUpdates.map((op) => op.where.id);

          await tx.$executeRaw`
            UPDATE inventory_items 
            SET status = CASE id ${updateCases} END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${itemIdsToUpdate})
              AND organization_id = ${this.organizationId}
          `;
        });

        console.log(`Batch completed: ${batch.length} items processed`);
      } catch (error) {
        console.error(`Failed to update batch:`, error);
        throw error;
      }
    }
  }
}

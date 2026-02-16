import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { InventoryItem } from '../models/inventory-item.model';
import { ItemTransaction } from '../models/item-transaction.model';

export class InventoryService {
  private prisma: PrismaClient;
  private organizationId: string;

  /**
   * Constructor with optional dependency injection
   * @param organizationId - Organization ID for tenant isolation
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   */
  constructor(organizationId?: string, prismaClient?: PrismaClient) {
    this.organizationId = organizationId ?? 'default-org';
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  /**
   * Get all inventory items
   */
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        product: {
          organizationId: this.organizationId,
        },
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
        product: {
          organizationId: this.organizationId,
        },
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
        product: {
          organizationId: this.organizationId,
        },
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
        product: {
          organizationId: this.organizationId,
        },
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
        product: {
          organizationId: this.organizationId,
        },
      },
    });
    return items.map(this.mapPrismaToModel);
  }

  /**
   * Create a new inventory item
   */
  async createInventoryItem(
    item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
    userId: number,
  ): Promise<InventoryItem> {
    const { productId, expiryDate, locationId } = item;

    // Validate that the product belongs to the organization
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        organizationId: this.organizationId,
      },
    });
    if (!product) {
      throw new Error('Product not found or does not belong to this organization');
    }

    // Validate that the location belongs to the organization
    const location = await this.prisma.storeArea.findFirst({
      where: {
        id: locationId,
        organizationId: this.organizationId,
      },
    });
    if (!location) {
      throw new Error('Location not found or does not belong to this organization');
    }

    // Calculate markdown status
    const calculatedStatus: 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' =
      item.status || (await this.calculateMarkdownStatus(item.expiryDate));

    const newItem = await this.prisma.inventoryItem.create({
      data: {
        productId,
        expiryDate: new Date(expiryDate), // Convert string to Date for Prisma
        locationId,
        status: calculatedStatus,
      },
    });

    // Create audit log entry
    const changeDescription = `Inventory item created with expiry date ${expiryDate} and status ${calculatedStatus}.`;
    await this.createAuditLog(userId, newItem.id, changeDescription);

    return this.mapPrismaToModel(newItem);
  }

  /**
   * Update an existing inventory item
   */
  async updateInventoryItem(
    id: number,
    updates: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>,
    userId: number,
  ): Promise<InventoryItem | null> {
    const existingItem = await this.getInventoryItemById(id);
    if (!existingItem) {
      return null;
    }

    if (Object.keys(updates).length === 0) {
      return existingItem; // No updates to perform
    }

    // Validate product belongs to organization if being updated
    if (updates.productId !== undefined) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: updates.productId,
          organizationId: this.organizationId,
        },
      });
      if (!product) {
        throw new Error('Product not found or does not belong to this organization');
      }
    }

    // Validate location belongs to organization if being updated
    if (updates.locationId !== undefined) {
      const location = await this.prisma.storeArea.findFirst({
        where: {
          id: updates.locationId,
          organizationId: this.organizationId,
        },
      });
      if (!location) {
        throw new Error('Location not found or does not belong to this organization');
      }
    }

    // If expiry date is updated, recalculate markdown status
    let statusUpdate = updates.status;
    if (updates.expiryDate) {
      statusUpdate = await this.calculateMarkdownStatus(updates.expiryDate);
    }

    const updatedItem = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(updates.productId !== undefined && { productId: updates.productId }),
        ...(updates.expiryDate !== undefined && { expiryDate: new Date(updates.expiryDate) }), // Convert string to Date
        ...(updates.locationId !== undefined && { locationId: updates.locationId }),
        ...(statusUpdate !== undefined && { status: statusUpdate }),
      },
    });

    // Create audit log entry
    const changeDescription = `Inventory item updated: ${JSON.stringify(updates)}`;
    await this.createAuditLog(userId, id, changeDescription);

    return this.mapPrismaToModel(updatedItem);
  }

  /**
   * Delete an inventory item
   */
  async deleteInventoryItem(id: number, userId: number): Promise<boolean> {
    // Get the item before deleting to use in audit log
    const item = await this.getInventoryItemById(id);
    if (!item) {
      return false; // Item doesn't exist or doesn't belong to this organization
    }

    // Create audit log entry before deleting the item
    const changeDescription = `Inventory item with ID ${id} deleted.`;
    await this.createAuditLog(userId, id, changeDescription);

    await this.prisma.inventoryItem.delete({
      where: { id },
    });

    return true;
  }

  /**
   * Synchronous version of calculateMarkdownStatus for use in batch operations
   */
  calculateMarkdownStatusSync(
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
    if (daysDiff <= 7) {
      // Within 1 week from expiry: cost price - 20% (Markdown 3)
      return 'Markdown 3';
    } else if (daysDiff <= 14) {
      // Within 2 weeks from expiry: cost price (Markdown 2)
      return 'Markdown 2';
    } else if (daysDiff <= 30) {
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

    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysDiff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    let status: 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' = 'Normal';

    if (daysDiff <= 0) {
      status = 'Expired';
    } else {
      // Apply markdown rules based on days difference (from feature requirements)
      // Note: These are simple examples. Real logic might be more complex.
      if (daysDiff <= 7) {
        // Within 1 week from expiry: cost price - 20% (Markdown 3)
        status = 'Markdown 3';
      } else if (daysDiff <= 14) {
        // Within 2 weeks from expiry: cost price (Markdown 2)
        status = 'Markdown 2';
      } else if (daysDiff <= 30) {
        // Within 1 month from expiry: cost price + 20% (Markdown 1)
        status = 'Markdown 1';
      } else {
        // More than 1 month from expiry: Normal (no markdown)
        status = 'Normal';
      }
    }

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
    if (daysDiff <= 30) {
      // Within 1 month from expiry: cost price - 20% (Markdown 3)
      return 'Markdown 3';
    } else if (daysDiff <= 60) {
      // Within 2 months from expiry: cost price (Markdown 2)
      return 'Markdown 2';
    } else if (daysDiff <= 90) {
      // Within 3 months from expiry: cost price + 20% (Markdown 1)
      return 'Markdown 1';
    } else {
      // More than 3 months from expiry: Normal (no markdown)
      return 'Normal';
    }
  }

  /**
   * Create an audit log entry
   */
  private async createAuditLog(
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<void> {
    // Validate that the user belongs to the organization
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: this.organizationId,
      },
    });
    if (!user) {
      throw new Error('User not found or does not belong to this organization');
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        inventoryItemId,
        action: 'inventory_changed',
        changeDescription,
      },
    });
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
}

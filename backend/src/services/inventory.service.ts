import { PrismaClient, Prisma } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { InventoryItem } from '../models/inventory-item.model';
import { ItemTransaction } from '../models/item-transaction.model';
import { getOrganizationId } from '../utils/auth-bypass';
import { injectable, inject } from 'tsyringe';

import { InventoryRepository } from '../repositories/inventory.repository';
import { ProductRepository } from '../repositories/product.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { UserRepository } from '../repositories/user.repository';
import { AuditLogRepository } from '../repositories/audit-log.repository';
import { StoreAreaRepository } from '../repositories/store-area.repository';
import {
  calculateInventoryMarkdownPrice,
  calculateInventoryMarkdownStatus,
  INVENTORY_MARKDOWN_THRESHOLDS,
} from './inventory-markdown.helpers';

export interface CreateInventoryItemInput {
  productId: number;
  expiryDate: string;
  locationId: number;
  status?: InventoryItem['status'];
}

type InventoryItemRaw = {
  id: number;
  productId: number;
  organizationId: string | null;
  expiryDate: Date;
  locationId: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type DbClient = PrismaClient | Prisma.TransactionClient;
type InventoryStatus = InventoryItem['status'];
type InventoryTransactionInput = Omit<ItemTransaction, 'id' | 'transaction_date'>;

@injectable()
export class InventoryService {
  private prisma: PrismaClient;
  private organizationId: string;
  private inventoryRepo: InventoryRepository;
  private subscriptionRepo: SubscriptionRepository;
  private userRepo: UserRepository;
  private auditLogRepo: AuditLogRepository;
  private storeAreaRepo: StoreAreaRepository;
  private productRepo: ProductRepository;

  // Markdown thresholds in days
  private static readonly MARKDOWN_THRESHOLDS = INVENTORY_MARKDOWN_THRESHOLDS;

  /**
   * Constructor with optional dependency injection
   * @param organizationId - Organization ID for tenant isolation (optional in tests)
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   * @param inventoryRepo - Optional InventoryRepository
   * @param productRepo - Optional ProductRepository
   * @param subscriptionRepo - Optional SubscriptionRepository
   * @param userRepo - Optional UserRepository
   * @param auditLogRepo - Optional AuditLogRepository
   * @param storeAreaRepo - Optional StoreAreaRepository
   */
  constructor(
    @inject('OrganizationId') organizationId?: string,
    @inject(PrismaClient) prismaClient?: PrismaClient,
    @inject(InventoryRepository) inventoryRepo?: InventoryRepository,
    @inject(ProductRepository) productRepo?: ProductRepository,
    @inject(SubscriptionRepository) subscriptionRepo?: SubscriptionRepository,
    @inject(UserRepository) userRepo?: UserRepository,
    @inject(AuditLogRepository) auditLogRepo?: AuditLogRepository,
    @inject(StoreAreaRepository) storeAreaRepo?: StoreAreaRepository,
  ) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.inventoryRepo = inventoryRepo ?? new InventoryRepository(this.prisma);
    this.productRepo = productRepo ?? new ProductRepository(this.prisma);
    this.subscriptionRepo = subscriptionRepo ?? new SubscriptionRepository(this.prisma);
    this.userRepo = userRepo ?? new UserRepository(this.prisma);
    this.auditLogRepo = auditLogRepo ?? new AuditLogRepository(this.prisma);
    this.storeAreaRepo = storeAreaRepo ?? new StoreAreaRepository(this.prisma);
  }

  /**
   * Get all inventory items
   */
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    const items = await this.inventoryRepo.findAll(this.organizationId);
    return items.map((item) => this.mapPrismaToModel(item));
  }

  /**
   * Get a specific inventory item by ID
   */
  async getInventoryItemById(id: number): Promise<InventoryItem | null> {
    const item = await this.inventoryRepo.findById(id, this.organizationId);
    return item ? this.mapPrismaToModel(item) : null;
  }

  /**
   * Get inventory items for a specific product
   */
  async getInventoryItemsByProductId(productId: number): Promise<InventoryItem[]> {
    const items = await this.inventoryRepo.findByProductId(productId, this.organizationId);
    return items.map((item) => this.mapPrismaToModel(item));
  }

  /**
   * Get the most recent inventory items for a specific product
   */
  async getRecentInventoryItemsByProductId(
    productId: number,
    limit: number,
  ): Promise<InventoryItem[]> {
    const items = await this.inventoryRepo.findRecentByProductId(
      productId,
      this.organizationId,
      limit,
    );
    return items.map((item) => this.mapPrismaToModel(item));
  }

  /**
   * Get inventory items for a specific location
   */
  async getInventoryItemsByLocationId(locationId: number): Promise<InventoryItem[]> {
    const items = await this.inventoryRepo.findByLocationId(locationId, this.organizationId);
    return items.map((item) => this.mapPrismaToModel(item));
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
      await this.validateProductOwnership(productId, tx);
      await this.validateLocationOwnership(locationId, tx);

      const usage = await this.subscriptionRepo.findUsageByOrganizationId(this.organizationId, tx);

      if (usage?.maxInventoryItems !== null && usage?.maxInventoryItems !== undefined) {
        if (usage.totalInventoryItems >= usage.maxInventoryItems) {
          throw new Error(
            `Cannot create inventory item: maximum limit of ${usage.maxInventoryItems} inventory items reached. ` +
            `Current usage: ${usage.totalInventoryItems}.`,
          );
        }
      }

      const calculatedStatus = item.status || (await this.calculateMarkdownStatus(expiryDate));

      const newItem = await this.inventoryRepo.create(
        {
          organizationId: this.organizationId,
          productId: item.productId,
          expiryDate: new Date(expiryDate),
          locationId: item.locationId,
          status: calculatedStatus,
        },
        tx,
      );

      await this.subscriptionRepo.updateUsage(
        this.organizationId,
        {
          totalInventoryItems: { increment: 1 },
        },
        tx,
      );

      const changeDescription = `Inventory item created with expiry date ${expiryDate} and status ${calculatedStatus}.`;
      await this.createAuditLogInTransaction(tx, userId, newItem.id, changeDescription);

      return newItem;
    });

    return this.mapPrismaToModel(result);
  }

  /**
   * Update an inventory item
   */
  async updateInventoryItem(
    id: number,
    item: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>>,
    userId: number,
  ): Promise<InventoryItem | null> {
    if (Object.keys(item).length === 0) {
      return this.getInventoryItemById(id);
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingItem = await this.inventoryRepo.findByOrganizationIdAndId(
          id,
          this.organizationId,
          tx,
        );
        if (!existingItem) {
          return null;
        }

        if (item.productId !== undefined) {
          await this.validateProductOwnership(item.productId, tx);
        }
        if (item.locationId !== undefined) {
          await this.validateLocationOwnership(item.locationId, tx);
        }

        const statusUpdate = item.expiryDate
          ? await this.calculateMarkdownStatus(item.expiryDate)
          : item.status;

        const updatedItem = await this.inventoryRepo.update(
          id,
          this.organizationId,
          {
            ...(item.productId !== undefined && { productId: item.productId }),
            ...(item.expiryDate !== undefined && { expiryDate: new Date(item.expiryDate) }),
            ...(item.locationId !== undefined && { locationId: item.locationId }),
            ...(statusUpdate !== undefined && { status: statusUpdate }),
          },
          tx,
        );

        const changeDescription = this.formatChangeDescription(item);
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
        const existingItem = await this.inventoryRepo.findByOrganizationIdAndId(
          id,
          this.organizationId,
          tx,
        );
        if (!existingItem) {
          throw new Error('Inventory item not found');
        }

        await this.createAuditLogInTransaction(
          tx,
          userId,
          id,
          `Inventory item with ID ${id} deleted.`,
        );

        await this.inventoryRepo.delete(id, this.organizationId, tx);

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
   * Log a transaction for an inventory item
   */
  async logTransaction(transaction: InventoryTransactionInput): Promise<number> {
    const { inventory_item_id, user_id } = transaction;

    const item = await this.getInventoryItemById(inventory_item_id);
    if (!item) {
      throw new Error('Inventory item not found or does not belong to this organization');
    }

    const user = await this.userRepo.findById(user_id, this.organizationId);
    if (!user) {
      throw new Error('User not found or does not belong to this organization');
    }

    const result = await this.logTransactionInternal(transaction);
    return result.id;
  }

  /**
   * Internal helper for logging transactions (supports existing transaction context)
   */
  private async logTransactionInternal(
    transaction: InventoryTransactionInput,
    tx?: DbClient,
  ): Promise<any> {
    const client = tx ?? this.prisma;
    return client.itemTransaction.create({
      data: {
        organizationId: this.organizationId,
        inventoryItemId: transaction.inventory_item_id,
        userId: transaction.user_id,
        type: transaction.type,
        quantityChange: transaction.quantity_change,
        notes: transaction.notes,
      },
    });
  }

  calculateMarkdownStatusSync(expiryDate: string): InventoryStatus {
    return this.calculateMarkdownStatusInternal(expiryDate);
  }

  private calculateMarkdownStatusInternal(expiryDate: string): InventoryStatus {
    return calculateInventoryMarkdownStatus(expiryDate);
  }

  async calculateMarkdownStatus(expiryDate: string): Promise<InventoryStatus> {
    return this.calculateMarkdownStatusInternal(expiryDate);
  }

  async autoCalculateMarkdownStatus(itemId: number, expiryDate: string): Promise<void> {
    const item = await this.getInventoryItemById(itemId);
    if (!item) {
      throw new Error('Inventory item not found or does not belong to this organization');
    }

    const status = this.calculateMarkdownStatusInternal(expiryDate);
    await this.inventoryRepo.update(itemId, this.organizationId, { status });
  }

  async bulkUpdateMarkdownStatuses(
    items: Array<{ id: number; expiryDate: string }>,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const batchSize = 100;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await this.prisma.$transaction(async (tx) => {
        const itemIds = batch.map((item) => item.id);
        const existingItems = await this.inventoryRepo.findManyByIds(
          itemIds,
          this.organizationId,
          tx,
        );
        const existingItemIds = new Set(existingItems.map((item) => item.id));

        const updates = batch
          .filter((item) => existingItemIds.has(item.id))
          .map((item) => ({
            id: item.id,
            status: this.calculateMarkdownStatusInternal(item.expiryDate),
          }));

        await this.inventoryRepo.updateManyByIds(updates, tx);
      });
    }
  }

  /**
   * Calculate markdown price for an inventory item based on its expiry date
   */
  async calculateMarkdownPrice(id: number): Promise<number | null> {
    const item = await this.inventoryRepo.findUniqueWithProduct(id, this.organizationId);

    if (!item || !item.product || item.product.costPrice === null) {
      return null;
    }

    return calculateInventoryMarkdownPrice(item.product.costPrice, item.expiryDate);
  }

  private async validateResourceOwnership(
    resourceType: 'product' | 'storeArea',
    resourceId: number,
    client: DbClient,
  ): Promise<void> {
    const resource =
      resourceType === 'product'
        ? await this.productRepo.findById(resourceId, this.organizationId, client)
        : await this.storeAreaRepo.findById(resourceId, this.organizationId, client);

    if (!resource) {
      const resourceTypeName = resourceType === 'storeArea' ? 'Location' : 'Product';
      throw new Error(`${resourceTypeName} not found or does not belong to this organization`);
    }
  }

  private async validateProductOwnership(productId: number, client: DbClient): Promise<void> {
    await this.validateResourceOwnership('product', productId, client);
  }

  private async validateLocationOwnership(locationId: number, client: DbClient): Promise<void> {
    await this.validateResourceOwnership('storeArea', locationId, client);
  }

  private handlePrismaError(error: unknown): null {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2025'
    ) {
      return null;
    }
    throw error;
  }

  private async decrementInventoryCount(client: DbClient): Promise<void> {
    const currentUsage = await this.subscriptionRepo.findUsageByOrganizationId(
      this.organizationId,
      client,
    );

    if (currentUsage && currentUsage.totalInventoryItems > 0) {
      await this.subscriptionRepo.updateUsage(
        this.organizationId,
        {
          totalInventoryItems: { decrement: 1 },
        },
        client,
      );
    }
  }

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

  private async createAuditLogBase(
    client: DbClient,
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId, this.organizationId, client);
    if (!user) {
      throw new Error('User not found or does not belong to this organization');
    }

    await this.auditLogRepo.create(
      {
        organizationId: this.organizationId,
        userId,
        inventoryItemId,
        action: 'inventory_changed',
        changeDescription,
      },
      client,
    );
  }

  private async createAuditLogInTransaction(
    tx: Prisma.TransactionClient,
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<void> {
    await this.createAuditLogBase(tx, userId, inventoryItemId, changeDescription);
  }

  /**
   * Map Prisma model to legacy InventoryItem interface
   */
  private mapPrismaToModel(item: InventoryItemRaw): InventoryItem {
    return {
      id: item.id,
      productId: item.productId,
      organizationId: item.organizationId ?? this.organizationId,
      expiryDate: item.expiryDate.toISOString(),
      locationId: item.locationId,
      status: item.status as InventoryItem['status'],
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}

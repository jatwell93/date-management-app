import { Response, NextFunction } from 'express';
import { InventoryService } from '../services/inventory.service';
import { ProductService } from '../services/product.service';
import { Logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth.middleware';
import { InventoryItem } from '../models/inventory-item.model';
import { injectable, inject } from 'tsyringe';
import validator from 'validator';
import { NotFoundError, AuthorizationError, ValidationError, AuthenticationError } from '../errors';

@injectable()
export class InventoryController {
  constructor(
    @inject('InventoryServiceFactory')
    private inventoryServiceFactory: (orgId: string) => InventoryService,
    @inject('ProductServiceFactory')
    private productServiceFactory: (orgId: string) => ProductService,
  ) {}

  private getServices(req: AuthRequest) {
    if (!req.organizationId) {
      throw new AuthenticationError('Organization context missing');
    }
    const inventoryService = this.inventoryServiceFactory(req.organizationId);
    const productService = this.productServiceFactory(req.organizationId);
    return { inventoryService, productService };
  }

  async getAllInventoryItems(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { inventoryService } = this.getServices(req);
      const items = await inventoryService.getAllInventoryItems();
      res.json(items);
    } catch (error) {
      next(error);
    }
  }

  async getInventoryItemById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError('Invalid inventory item id');
      }
      const { inventoryService } = this.getServices(req);
      const item = await inventoryService.getInventoryItemById(id);

      if (!item) {
        throw new NotFoundError('Inventory item not found');
      }

      if (item.organizationId !== req.organizationId) {
        throw new AuthorizationError('Access denied: Item belongs to different organization');
      }

      res.json(item);
    } catch (error) {
      next(error);
    }
  }

  async getInventoryItemsByProductId(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const productId = Number.parseInt(req.params.productId, 10);
      if (Number.isNaN(productId)) {
        throw new ValidationError('Invalid product id');
      }
      const { inventoryService } = this.getServices(req);
      const items = await inventoryService.getInventoryItemsByProductId(productId);
      res.json(items);
    } catch (error) {
      next(error);
    }
  }

  async getInventoryItemsByBarcode(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const barcode = req.params.barcode;
      const sanitizedBarcode = barcode.replace(/-/g, '');
      if (
        !validator.isAlphanumeric(sanitizedBarcode) ||
        sanitizedBarcode.length < 8 ||
        sanitizedBarcode.length > 14
      ) {
        throw new ValidationError('Invalid barcode format');
      }

      const { productService, inventoryService } = this.getServices(req);
      const product = await productService.getProductByBarcode(barcode);

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      const items = await inventoryService.getInventoryItemsByProductId(product.id);
      res.json(items);
    } catch (error) {
      next(error);
    }
  }

  async getRecentInventoryItemsByProductId(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const productId = Number.parseInt(req.params.productId, 10);
      if (Number.isNaN(productId)) {
        throw new ValidationError('Invalid product id');
      }
      const limitParam = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isNaN(limitParam) || limitParam <= 0 ? 5 : limitParam;

      const { inventoryService } = this.getServices(req);
      const items = await inventoryService.getRecentInventoryItemsByProductId(productId, limit);
      res.json(items);
    } catch (error) {
      next(error);
    }
  }

  async getInventoryItemsByLocationId(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const locationId = Number.parseInt(req.params.locationId, 10);
      if (Number.isNaN(locationId)) {
        throw new ValidationError('Invalid location id');
      }
      const { inventoryService } = this.getServices(req);
      const items = await inventoryService.getInventoryItemsByLocationId(locationId);
      res.json(items);
    } catch (error) {
      next(error);
    }
  }

  async createInventoryItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId, expiryDate, locationId, status } = req.body;

      if (
        productId === undefined ||
        productId === null ||
        typeof productId !== 'number' ||
        Number.isNaN(productId) ||
        productId < 1 ||
        !expiryDate ||
        locationId === undefined ||
        locationId === null ||
        typeof locationId !== 'number' ||
        Number.isNaN(locationId) ||
        locationId < 1
      ) {
        throw new ValidationError('Missing required inventory item fields');
      }

      const userId = req.userId;
      if (!userId) {
        throw new AuthenticationError('Access denied: No user ID found');
      }
      const { inventoryService } = this.getServices(req);
      const newInventoryItem = await inventoryService.createInventoryItem(
        {
          productId,
          expiryDate,
          locationId,
          status,
        } as Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
        userId,
      );
      res.status(201).json(newInventoryItem);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Location does not exist') {
        throw new ValidationError('Location does not exist');
      }
      next(error);
    }
  }

  async updateInventoryItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError('Invalid inventory item id');
      }

      const { inventoryService } = this.getServices(req);
      const existingItem = await inventoryService.getInventoryItemById(id);
      if (!existingItem) {
        throw new NotFoundError('Inventory item not found');
      }

      if (existingItem.organizationId !== req.organizationId) {
        throw new AuthorizationError('Access denied: Item belongs to different organization');
      }

      const { productId, expiryDate, locationId, status } = req.body;
      const userId = req.userId;
      if (!userId) {
        throw new AuthenticationError('Access denied: No user ID found');
      }

      const updateData: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>> = {};
      if (productId !== undefined) updateData.productId = productId;
      if (expiryDate !== undefined) updateData.expiryDate = expiryDate;
      if (locationId !== undefined) updateData.locationId = locationId;
      if (status !== undefined) updateData.status = status;

      const updatedItem = await inventoryService.updateInventoryItem(id, updateData, userId);

      if (!updatedItem) {
        throw new NotFoundError('Inventory item not found');
      }

      res.json(updatedItem);
    } catch (error) {
      next(error);
    }
  }

  async deleteInventoryItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError('Invalid inventory item id');
      }

      const { inventoryService } = this.getServices(req);
      const existingItem = await inventoryService.getInventoryItemById(id);
      if (!existingItem) {
        throw new NotFoundError('Inventory item not found');
      }

      if (existingItem.organizationId !== req.organizationId) {
        throw new AuthorizationError('Access denied: Item belongs to different organization');
      }

      const userId = req.userId;
      if (!userId) {
        throw new AuthenticationError('Access denied: No user ID found');
      }
      const deleted = await inventoryService.deleteInventoryItem(id, userId);

      if (!deleted) {
        throw new NotFoundError('Inventory item not found');
      }

      res.json({ message: 'Inventory item deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async logTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { inventoryService } = this.getServices(req);
      const transaction = req.body;
      const newTransactionId = await inventoryService.logTransaction(transaction);

      res.status(201).json({
        message: 'Transaction logged successfully',
        transactionId: newTransactionId,
      });
    } catch (error) {
      Logger.error('Error logging transaction', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      next(error);
    }
  }
}

import { Response, NextFunction } from 'express';
import { ProductService } from '../services/product.service';
import { Logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth.middleware';
import { Product } from '../models/product.model';
import { TIER_LIMITS, TierLevel } from '../types/subscription';
import { escapeCSVValue } from '../utils/csv';
import * as path from 'path';
import fs from 'fs';
import {
  NotFoundError,
  AuthorizationError,
  ValidationError,
  AuthenticationError,
  isBaseError,
} from '../errors';
import { injectable, inject } from 'tsyringe';
import { ProductRepository } from '../repositories/product.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';

@injectable()
export class ProductController {
  constructor(
    @inject('ProductServiceFactory')
    private productServiceFactory: (orgId: string) => ProductService,
    private productRepository: ProductRepository,
    private subscriptionRepository: SubscriptionRepository,
  ) { }

  private getService(req: AuthRequest): ProductService {
    if (!req.organizationId) {
      throw new AuthenticationError('Organization context missing');
    }
    return this.productServiceFactory(req.organizationId);
  }

  private handleRouteError(error: unknown, res: Response, next: NextFunction): void {
    if (isBaseError(error)) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    next(error);
  }

  async getAllProducts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productService = this.getService(req);
      const products = await productService.getAllProducts();
      res.json(products);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async getProductByBarcode(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { barcode } = req.params;
      const productService = this.getService(req);
      const product = await productService.getProductByBarcode(barcode);

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      res.json(product);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async getProductBySku(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sku } = req.params;
      const productService = this.getService(req);
      const product = await productService.getProductBySku(sku);

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      res.json(product);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async getProductById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError('Invalid product id');
      }
      const productService = this.getService(req);
      const product = await productService.getProductById(id);

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      // Validate product belongs to user's organization
      if (product.organizationId !== req.organizationId) {
        throw new AuthorizationError('Access denied: Product belongs to different organization');
      }

      res.json(product);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async createProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { barcode, sku, name, costPrice } = req.body;
      if (!barcode || !sku || !name || costPrice === undefined) {
        throw new ValidationError('Missing required product fields');
      }

      const productService = this.getService(req);
      const newProduct = await productService.createProduct({
        barcode,
        sku,
        name,
        costPrice,
      } as Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>);
      res.status(201).json(newProduct);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async updateProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError('Invalid product id');
      }
      const { barcode, sku, name, costPrice } = req.body;

      const productService = this.getService(req);
      const existingProduct = await productService.getProductById(id);
      if (!existingProduct) {
        throw new NotFoundError('Product not found');
      }
      if (existingProduct.organizationId !== req.organizationId) {
        throw new AuthorizationError('Access denied: Product belongs to different organization');
      }

      // Build update object
      const updateData: Partial<
        Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>
      > = {};
      if (barcode !== undefined) updateData.barcode = barcode;
      if (sku !== undefined) updateData.sku = sku;
      if (name !== undefined) updateData.name = name;
      if (costPrice !== undefined) updateData.costPrice = costPrice;

      const updatedProduct = await productService.updateProduct(id, updateData);

      if (!updatedProduct) {
        throw new NotFoundError('Product not found');
      }

      res.json(updatedProduct);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async deleteProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        throw new ValidationError('Invalid product id');
      }

      const productService = this.getService(req);
      const existingProduct = await productService.getProductById(id);
      if (!existingProduct) {
        throw new NotFoundError('Product not found');
      }
      if (existingProduct.organizationId !== req.organizationId) {
        throw new AuthorizationError('Access denied: Product belongs to different organization');
      }

      const deleted = await productService.deleteProduct(id);

      if (!deleted) {
        throw new NotFoundError('Product not found');
      }

      res.json({ message: 'Product deleted successfully' });
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async exportExcess(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.organizationId;

      if (!organizationId) {
        throw new AuthenticationError('Organization context missing');
      }

      const subscription = await this.subscriptionRepository.findByOrganizationId(organizationId);

      if (!subscription) {
        throw new NotFoundError('Subscription not found');
      }

      const tierLevel = subscription.tierLevel as TierLevel;
      const maxSkus = TIER_LIMITS[tierLevel].max_skus;

      // Unlimited tier - no excess products
      if (maxSkus === null) {
        res.json({
          message: 'Current tier has unlimited SKUs',
          excessCount: 0,
          products: [],
        });
        return;
      }

      const usage = await this.subscriptionRepository.findUsageByOrganizationId(organizationId);

      const currentCount = usage?.totalSkus || 0;
      const excessCount = currentCount - maxSkus;

      if (excessCount <= 0) {
        res.json({
          message: 'Organization is within SKU limits',
          tier: tierLevel,
          maxSkus,
          currentSkus: currentCount,
          excessCount: 0,
          products: [],
        });
        return;
      }

      const excessProducts = await this.productRepository.findExcessProductsByOrganization(
        organizationId,
        maxSkus,
      );

      // Format response
      const products = excessProducts.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        barcode: p.barcode,
        costPrice: p.costPrice,
        createdAt: p.createdAt.toISOString(),
        inventoryCount: p._count.inventoryItems,
      }));

      // Determine response format based on Accept header
      const acceptHeader = req.get('Accept') || '';
      if (acceptHeader.includes('text/csv') || req.query.format === 'csv') {
        // CSV response
        const headers = [
          'id',
          'sku',
          'name',
          'barcode',
          'costPrice',
          'createdAt',
          'inventoryCount',
        ];
        const csvRows = [
          headers.join(','),
          ...products.map((p) =>
            headers.map((h) => escapeCSVValue(p[h as keyof typeof p])).join(','),
          ),
        ];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="excess-products-${organizationId}.csv"`,
        );
        res.send(csvRows.join('\n'));
        return;
      }

      // JSON response
      res.json({
        metadata: {
          organizationId,
          tier: tierLevel,
          maxSkus,
          currentSkus: currentCount,
          excessCount,
        },
        products,
      });
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async uploadCsv(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        throw new ValidationError('No file provided', [
          {
            field: 'file',
            message: 'Please select a CSV, XLSX, or XLS file to upload.',
          },
        ]);
      }

      // Normalize and validate the uploaded file path
      const uploadDir = path.dirname(req.file.path);
      const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
      if (!safeFilePath.startsWith(uploadDir + path.sep)) {
        throw new ValidationError('Invalid file path');
      }

      // Process the uploaded file
      const productService = this.getService(req);
      const result = await productService.processCSVUpload(safeFilePath, req.file.originalname);

      // Send response
      const responseObj: {
        success: boolean;
        message: string;
        imported: number;
        updated: number;
        errors?: string[];
      } = {
        success: result.errors.length === 0,
        message:
          result.errors.length > 0
            ? `CSV processed with ${result.errors.length} error(s). See 'errors' field for details.`
            : 'CSV processed successfully',
        imported: result.imported,
        updated: result.updated,
      };

      if (result.errors.length > 0) {
        responseObj.errors = result.errors;
      }

      res.json(responseObj);
    } catch (error: unknown) {
      this.handleRouteError(error, res, next);
    } finally {
      // Clean up the uploaded file after processing
      if (req.file) {
        const uploadDir = path.dirname(req.file.path);
        const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
        if (safeFilePath.startsWith(uploadDir + path.sep)) {
          fs.unlink(safeFilePath, (err: NodeJS.ErrnoException | null) => {
            if (err) {
              Logger.error('Error deleting uploaded file', { error: err.message });
            }
          });
        }
      }
    }
  }
}

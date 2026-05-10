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

type ProductUpdateData = Partial<
  Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>
>;
type SafeUploadFile = {
  safeFilePath: string;
  originalFilename: string;
};

@injectable()
export class ProductController {
  constructor(
    @inject('ProductServiceFactory')
    private productServiceFactory: (orgId: string) => ProductService,
    private productRepository: ProductRepository,
    private subscriptionRepository: SubscriptionRepository,
  ) {}

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

  private parseProductId(req: AuthRequest): number {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid product id');
    }
    return id;
  }

  private assertProductBelongsToOrganization(product: Product, req: AuthRequest): void {
    if (product.organizationId !== req.organizationId) {
      throw new AuthorizationError('Access denied: Product belongs to different organization');
    }
  }

  private async getExistingProduct(
    productService: ProductService,
    id: number,
    req: AuthRequest,
  ): Promise<Product> {
    const product = await productService.getProductById(id);
    if (!product) {
      throw new NotFoundError('Product not found');
    }

    this.assertProductBelongsToOrganization(product, req);
    return product;
  }

  private buildProductUpdateData(req: AuthRequest): ProductUpdateData {
    const { barcode, sku, name, costPrice } = req.body;
    return {
      ...(barcode !== undefined ? { barcode } : {}),
      ...(sku !== undefined ? { sku } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(costPrice !== undefined ? { costPrice } : {}),
    };
  }

  private async getProductByLookup(
    req: AuthRequest,
    lookupValue: string,
    lookup: (service: ProductService, value: string) => Promise<Product | null>,
  ): Promise<Product> {
    const product = await lookup(this.getService(req), lookupValue);
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    return product;
  }

  private getSafeUploadedFile(req: AuthRequest): SafeUploadFile {
    if (!req.file) {
      throw new ValidationError('No file provided', [
        {
          field: 'file',
          message: 'Please select a CSV, XLSX, or XLS file to upload.',
        },
      ]);
    }

    const uploadDir = path.dirname(req.file.path);
    const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
    if (!safeFilePath.startsWith(uploadDir + path.sep)) {
      throw new ValidationError('Invalid file path');
    }
    return { safeFilePath, originalFilename: req.file.originalname };
  }

  private sendExcessProductsCsv(
    res: Response,
    organizationId: string,
    products: Array<Record<string, string | number>>,
  ): void {
    const headers = ['id', 'sku', 'name', 'barcode', 'costPrice', 'createdAt', 'inventoryCount'];
    const csvRows = [
      headers.join(','),
      ...products.map((product) =>
        headers.map((header) => escapeCSVValue(product[header])).join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="excess-products-${organizationId}.csv"`,
    );
    res.send(csvRows.join('\n'));
  }

  private buildUploadResponse(result: { imported: number; updated: number; errors: string[] }): {
    success: boolean;
    message: string;
    imported: number;
    updated: number;
    errors?: string[];
  } {
    const responseObj = {
      success: result.errors.length === 0,
      message:
        result.errors.length > 0
          ? `CSV processed with ${result.errors.length} error(s). See 'errors' field for details.`
          : 'CSV processed successfully',
      imported: result.imported,
      updated: result.updated,
      ...(result.errors.length > 0 ? { errors: result.errors } : {}),
    };

    return responseObj;
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
      const product = await this.getProductByLookup(req, req.params.barcode, (service, barcode) =>
        service.getProductByBarcode(barcode),
      );
      res.json(product);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async getProductBySku(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await this.getProductByLookup(req, req.params.sku, (service, sku) =>
        service.getProductBySku(sku),
      );
      res.json(product);
    } catch (error) {
      this.handleRouteError(error, res, next);
    }
  }

  async getProductById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productService = this.getService(req);
      const product = await this.getExistingProduct(productService, this.parseProductId(req), req);

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
      const id = this.parseProductId(req);
      const productService = this.getService(req);
      await this.getExistingProduct(productService, id, req);

      const updatedProduct = await productService.updateProduct(
        id,
        this.buildProductUpdateData(req),
      );

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
      const id = this.parseProductId(req);
      const productService = this.getService(req);
      await this.getExistingProduct(productService, id, req);

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

      const acceptHeader = req.get('Accept') || '';
      if (acceptHeader.includes('text/csv') || req.query.format === 'csv') {
        this.sendExcessProductsCsv(res, organizationId, products);
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
      const { safeFilePath, originalFilename } = this.getSafeUploadedFile(req);
      const productService = this.getService(req);
      const result = await productService.processCSVUpload(safeFilePath, originalFilename);

      res.json(this.buildUploadResponse(result));
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

import { Router, Request, Response, NextFunction } from 'express';
import { ProductService } from '../services/product.service';
import { Product } from '../models/product.model';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { productSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import multer, { FileFilterCallback } from 'multer';
import { standardLimiter } from '../middleware/rateLimiter';
import * as path from 'path';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { TIER_LIMITS, TierLevel } from '../types/subscription';
import { stringifyCSV, escapeCSVValue } from '../utils/csv';

const router = Router();

// Helper function to get services with organization context
function getProductServiceForRequest(req: AuthRequest) {
  return new ProductService(undefined, req.organizationId);
}

// Configure multer for file uploads - accept CSV, XLSX, and XLS files
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req: Request, file, cb: FileFilterCallback) => {
    // Accept CSV, XLSX, and XLS files
    if (
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.csv') ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, XLSX, and XLS files are allowed.'));
    }
  },
});

// GET /products - Get all products for the user's organization
router.get('/', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const productService = getProductServiceForRequest(req);
    const products = await productService.getAllProducts();
    res.json(products);
  } catch (error) {
    next(error);
  }
});

// GET /products/by-barcode/:barcode - Get a specific product by barcode [MOVED BEFORE :id CATCH-ALL]
router.get('/by-barcode/:barcode', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const barcode = req.params.barcode;
    const productService = getProductServiceForRequest(req);
    const product = await productService.getProductByBarcode(barcode);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// GET /products/by-sku/:sku - Get a specific product by SKU [MOVED BEFORE :id CATCH-ALL]
router.get('/by-sku/:sku', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sku = req.params.sku;
    const productService = getProductServiceForRequest(req);
    const product = await productService.getProductBySku(sku);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// GET /products/export-excess - Export products that exceed tier limit [MOVED BEFORE :id CATCH-ALL]
router.get('/export-excess', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getDefaultDatabaseClient();
    const organizationId = req.organizationId!;

    // Get current subscription tier
    const subscription = await prisma.subscriptionTier.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const tierLevel = subscription.tierLevel as TierLevel;
    const maxSkus = TIER_LIMITS[tierLevel].max_skus;

    // Unlimited tier - no excess products
    if (maxSkus === null) {
      return res.json({
        message: 'Current tier has unlimited SKUs',
        excessCount: 0,
        products: [],
      });
    }

    // Get current usage
    const usage = await prisma.organizationUsage.findUnique({
      where: { organizationId },
      select: { totalSkus: true },
    });

    const currentCount = usage?.totalSkus || 0;
    const excessCount = currentCount - maxSkus;

    if (excessCount <= 0) {
      return res.json({
        message: 'Organization is within SKU limits',
        tier: tierLevel,
        maxSkus,
        currentSkus: currentCount,
        excessCount: 0,
        products: [],
      });
    }

    // Get excess products (oldest first for deletion priority)
    const excessProducts = await prisma.product.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      skip: maxSkus,
      include: {
        _count: {
          select: { inventoryItems: true },
        },
      },
    });

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
      const headers = ['id', 'sku', 'name', 'barcode', 'costPrice', 'createdAt', 'inventoryCount'];
      const csvRows = [
        headers.join(','),
        ...products.map((p) =>
          headers.map((h) => escapeCSVValue(p[h as keyof typeof p])).join(','),
        ),
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="excess-products-${organizationId}.csv"`);
      return res.send(csvRows.join('\n'));
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
    next(error);
  }
});

// GET /products/:id - Get a specific product by ID [MOVED AFTER SPECIFIC ROUTES]
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const productService = getProductServiceForRequest(req);
    const product = await productService.getProductById(id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Validate product belongs to user's organization
    if (product.organizationId !== req.organizationId) {
      return res
        .status(403)
        .json({ message: 'Access denied: Product belongs to different organization' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// POST /products - Create a new product
router.post(
  '/',
  authenticateToken,
  checkUsageLimit('max_skus'),
  standardLimiter,
  validateRequest(productSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { barcode, sku, name, costPrice } = req.body;
    if (!barcode || !sku || !name || costPrice === undefined) {
      return res.status(400).json({ message: 'Missing required product fields' });
    }

    try {
      const productService = getProductServiceForRequest(req);
      const newProduct = await productService.createProduct({
        barcode,
        sku,
        name,
        costPrice,
        organizationId: req.organizationId!,
      } as Omit<Product, 'id' | 'createdAt' | 'updatedAt'>);
      res.status(201).json(newProduct);
    } catch (error) {
      next(error);
    }
  },
);

// PUT /products/:id - Update a product
router.put(
  '/:id',
  authenticateToken,
  standardLimiter,
  validateRequest(productSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid product id' });
      }
      const { barcode, sku, name, costPrice } = req.body;

      // Check if product exists and belongs to user's organization
      const productService = getProductServiceForRequest(req);
      const existingProduct = await productService.getProductById(id);
      if (!existingProduct) {
        return res.status(404).json({ message: 'Product not found' });
      }
      if (existingProduct.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: Product belongs to different organization' });
      }

      // Build update object
      const updateData: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>> = {};
      if (barcode !== undefined) updateData.barcode = barcode;
      if (sku !== undefined) updateData.sku = sku;
      if (name !== undefined) updateData.name = name;
      if (costPrice !== undefined) updateData.costPrice = costPrice;

      const updatedProduct = await productService.updateProduct(id, updateData);

      if (!updatedProduct) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json(updatedProduct);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /products/:id - Delete a product
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid product id' });
      }

      // Check if product exists and belongs to user's organization
      const productService = getProductServiceForRequest(req);
      const existingProduct = await productService.getProductById(id);
      if (!existingProduct) {
        return res.status(404).json({ message: 'Product not found' });
      }
      if (existingProduct.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: Product belongs to different organization' });
      }

      const deleted = await productService.deleteProduct(id);

      if (!deleted) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json({ message: 'Product deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

// POST /products/upload-csv - Upload and process a CSV, XLSX, or XLS file of products
router.post(
  '/upload-csv',
  authenticateToken,
  checkUsageLimit('max_skus'),
  standardLimiter,
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: 'No file provided',
          details:
            'Please select a CSV, XLSX, or XLS file to upload. The file should contain columns for SKU, Name, Cost, and Barcode with acceptable alternative names.',
        });
      }

      // Normalize and validate the uploaded file path to ensure it is within the upload directory
      const uploadDir = path.dirname(req.file.path);
      const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
      if (!safeFilePath.startsWith(uploadDir + path.sep)) {
        return res.status(400).json({
          message: 'Invalid file path',
          details: 'The uploaded file path is not valid.',
        });
      }

      // Process the uploaded file (passing original filename for type detection)
      const productService = getProductServiceForRequest(req);
      const result = await productService.processCSVUpload(safeFilePath, req.file.originalname);

      // Send response with processing results and any errors
      const responseObj: any = {
        success: result.errors.length === 0, // Add explicit success field
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
    } catch (error: any) {
      next(error);
    } finally {
      // Clean up the uploaded file after processing
      if (req.file) {
        const fs = require('fs');
        const uploadDir = path.dirname(req.file.path);
        const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
        if (safeFilePath.startsWith(uploadDir + path.sep)) {
          fs.unlink(safeFilePath, (err: any) => {
            if (err) {
              console.error('Error deleting uploaded file:', err);
            }
          });
        } else {
          console.error('Skipping deletion of file with invalid path:', req.file.path);
        }
      }
    }
  },
);

export default router;

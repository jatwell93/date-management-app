import { Router, Request, Response } from 'express';
import { ProductService } from '../services/product.service';
import { Product } from '../models/product.model';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { productSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import multer, { FileFilterCallback } from 'multer';
import { escapeHtml } from '../utils/normalize.function';
import { standardLimiter } from '../middleware/rateLimiter';
import * as path from 'path';

const router = Router();
const productService = new ProductService();

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
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // TODO: Phase 7 - Update service to accept organizationId parameter
    const products = await productService.getAllProducts(); // req.organizationId!
    res.json(escapeHtml(products));
  } catch (_error) {
    // console.error("Get products error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /products/:id - Get a specific product by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
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

    res.json(escapeHtml(product));
  } catch (_error) {
    // console.error("Get product error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /products/by-barcode/:barcode - Get a specific product by barcode
router.get('/by-barcode/:barcode', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const barcode = req.params.barcode;
    // TODO: Phase 7 - Update service to accept organizationId parameter
    const product = await productService.getProductByBarcode(barcode); // , req.organizationId!

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(escapeHtml(product));
  } catch (_error) {
    // console.error("Get product by barcode error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /products/by-sku/:sku - Get a specific product by SKU
router.get('/by-sku/:sku', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sku = req.params.sku;
    // TODO: Phase 7 - Update service to accept organizationId parameter
    const product = await productService.getProductBySku(sku); // , req.organizationId!

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(escapeHtml(product));
  } catch (_error) {
    // console.error("Get product by SKU error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /products - Create a new product
router.post(
  '/',
  authenticateToken,
  standardLimiter,
  validateRequest(productSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response) => {
    const { barcode, sku, name, costPrice } = req.body;
    if (!barcode || !sku || !name || costPrice === undefined) {
      return res.status(400).json({ message: 'Missing required product fields' });
    }

    try {
      const newProduct = await productService.createProduct({
        barcode,
        sku,
        name,
        costPrice,
        organizationId: req.organizationId!,
      } as Omit<Product, 'id' | 'createdAt' | 'updatedAt'>);
      res.status(201).json(escapeHtml(newProduct));
    } catch (_error) {
      // console.error("Create product error:", _error);
      res.status(500).json({ message: 'Internal server error' });
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
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid product id' });
      }
      const { barcode, sku, name, costPrice } = req.body;

      // Check if product exists and belongs to user's organization
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

      res.json(escapeHtml(updatedProduct));
    } catch (_error) {
      // console.error("Update product error:", _error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// DELETE /products/:id - Delete a product
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid product id' });
      }

      // Check if product exists and belongs to user's organization
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

      res.json(escapeHtml({ message: 'Product deleted successfully' }));
    } catch (_error) {
      // console.error("Delete product error:", _error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// POST /products/upload-csv - Upload and process a CSV, XLSX, or XLS file of products
router.post(
  '/upload-csv',
  authenticateToken,
  standardLimiter,
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
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
      // TODO: Phase 7 - Update service to accept organizationId parameter
      const result = await productService.processCSVUpload(safeFilePath, req.file.originalname); // , req.organizationId!

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

      res.json(escapeHtml(responseObj));
    } catch (error: any) {
      console.error('CSV upload error:', error);
      res.status(500).json({
        message: 'Internal server error during file processing',
        details:
          'An unexpected error occurred while processing the CSV, XLSX, or XLS file. Please check the file format and try again.',
      });
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

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { productSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import multer, { FileFilterCallback } from 'multer';
import { standardLimiter } from '../middleware/rateLimiter';
import { createProductController } from '../di/services';
import { envConfig } from '../config/environment';

const router = Router();

// Configure multer for file uploads - accept CSV, XLSX, and XLS files
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: envConfig.MAX_UPLOAD_SIZE_BYTES,
  },
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

function formatBytesAsMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

function handleUploadError(error: unknown, res: Response, next: NextFunction): void {
  if (!error) {
    next();
    return;
  }

  const uploadError = error as { code?: unknown; message?: unknown };

  if (uploadError.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      message: `File too large. Maximum upload size is ${formatBytesAsMb(
        envConfig.MAX_UPLOAD_SIZE_BYTES,
      )}.`,
    });
    return;
  }

  if (
    typeof uploadError.message === 'string' &&
    uploadError.message.startsWith('Invalid file type.')
  ) {
    res.status(400).json({ message: uploadError.message });
    return;
  }

  next(error);
}

function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    handleUploadError(error, res, next);
  });
}

// GET /products - Get all products for the user's organization
router.get('/', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const controller = createProductController();
  await controller.getAllProducts(req, res, next);
});

// GET /products/by-barcode/:barcode - Get a specific product by barcode
router.get(
  '/by-barcode/:barcode',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createProductController();
    await controller.getProductByBarcode(req, res, next);
  },
);

// GET /products/by-sku/:sku - Get a specific product by SKU
router.get(
  '/by-sku/:sku',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createProductController();
    await controller.getProductBySku(req, res, next);
  },
);

// GET /products/export-excess - Export products that exceed tier limit
router.get(
  '/export-excess',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createProductController();
    await controller.exportExcess(req, res, next);
  },
);

// GET /products/:id - Get a specific product by ID
router.get(
  '/:id',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createProductController();
    await controller.getProductById(req, res, next);
  },
);

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
    const controller = createProductController();
    await controller.createProduct(req, res, next);
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
    const controller = createProductController();
    await controller.updateProduct(req, res, next);
  },
);

// DELETE /products/:id - Delete a product
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createProductController();
    await controller.deleteProduct(req, res, next);
  },
);

// POST /products/upload-csv - Upload and process a CSV, XLSX, or XLS file of products
router.post(
  '/upload-csv',
  authenticateToken,
  checkUsageLimit('max_skus'),
  standardLimiter,
  uploadSingleFile,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createProductController();
    await controller.uploadCsv(req, res, next);
  },
);

export default router;

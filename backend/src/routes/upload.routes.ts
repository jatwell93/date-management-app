import express from 'express';
import multer from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';
import { UploadController } from '../controllers/upload.controller';
import { ServiceProvider } from '../services/service-provider';
import { validateRequest } from '../middleware/validateRequest';
import { uploadInitiateSchema, uploadCompleteSchema } from '../schemas';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Initialize dependencies via ServiceProvider
const serviceProvider = new ServiceProvider();
const uploadController = new UploadController(serviceProvider.getUploadService());

// Configure Multer for direct uploads (MemoryStorage for small files)
// Task 5.4: Configure file upload size limit (10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for direct upload
  },
});

/**
 * POST /api/upload/initiate
 * Initiate upload process - returns strategy (direct vs presigned)
 */
router.post(
  '/initiate',
  authenticateToken,
  checkUsageLimit('storage_bytes'),
  uploadLimiter,
  validateRequest(uploadInitiateSchema),
  (req: AuthRequest, res) => uploadController.initiate(req, res),
);

/**
 * POST /api/upload/direct
 * Handle direct file upload logic
 */
router.post(
  '/direct',
  authenticateToken,
  checkUsageLimit('storage_bytes'),
  uploadLimiter,
  upload.single('file'),
  (req: AuthRequest, res) => uploadController.direct(req, res),
);

/**
 * POST /api/upload/complete
 * Complete upload process (after presigned upload) and trigger parsing
 */
router.post(
  '/complete',
  authenticateToken,
  checkUsageLimit('storage_bytes'),
  uploadLimiter,
  validateRequest(uploadCompleteSchema),
  (req: AuthRequest, res) => uploadController.complete(req, res),
);

export default router;

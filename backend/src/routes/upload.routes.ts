import express from 'express';
import multer from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';
import { createUploadControllerForRequest } from '../controllers/upload.controller';
import { validateRequest } from '../middleware/validateRequest';
import { uploadInitiateSchema, uploadCompleteSchema } from '../schemas';
import { uploadLimiter, presignedUrlLimiter } from '../middleware/rateLimiter';

const router = express.Router();

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
 *
 * Rate Limited: 50 presigned URLs per hour per authenticated user
 * Security: Uses presignedUrlLimiter to prevent abuse of presigned URL generation
 * Reference: docs/security-audit.md, PHASE-20-SESSION-2-SUMMARY.md Task 9
 */
router.post(
  '/initiate',
  authenticateToken,
  checkUsageLimit('storage_bytes'),
  presignedUrlLimiter, // Rate limit presigned URL generation at authenticated user level
  validateRequest(uploadInitiateSchema),
  (req: AuthRequest, res) => {
    const uploadController = createUploadControllerForRequest(req);
    return uploadController.initiate(req, res);
  },
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
  (req: AuthRequest, res) => {
    const uploadController = createUploadControllerForRequest(req);
    return uploadController.direct(req, res);
  },
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
  (req: AuthRequest, res) => {
    const uploadController = createUploadControllerForRequest(req);
    return uploadController.complete(req, res);
  },
);

/**
 * GET /api/upload/status/:key
 * Get upload status for progress tracking
 */
router.get('/status/:key', authenticateToken, uploadLimiter, (req: AuthRequest, res) => {
  const uploadController = createUploadControllerForRequest(req);
  return uploadController.status(req, res);
});

export default router;

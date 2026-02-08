import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.middleware';
import { UploadController } from '../controllers/upload.controller';
import { ServiceProvider } from '../services/service-provider';

const router = express.Router();

// Initialize dependencies via ServiceProvider
const serviceProvider = new ServiceProvider();
const uploadController = new UploadController(serviceProvider.getUploadService());

// Configure Multer for direct uploads (MemoryStorage for small files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for direct upload (safety margin over 2MB threshold)
  },
});

/**
 * POST /api/upload/initiate
 * Initiate upload process - returns strategy (direct vs presigned)
 */
router.post('/initiate', authenticateToken, (req, res) => uploadController.initiate(req, res));

/**
 * POST /api/upload/direct
 * Handle direct file upload logic
 */
router.post('/direct', authenticateToken, upload.single('file'), (req, res) =>
  uploadController.direct(req, res),
);

/**
 * POST /api/upload/complete
 * Complete upload process (after presigned upload) and trigger parsing
 */
router.post('/complete', authenticateToken, (req, res) => uploadController.complete(req, res));

export default router;

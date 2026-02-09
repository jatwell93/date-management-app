import { Router } from 'express';
import {
  createBackup,
  restoreBackup,
  listBackups,
} from '../controllers/database.backup.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { backupRestoreSchema } from '../schemas';
import { standardLimiter } from '../middleware/rateLimiter';

const router = Router();

// Database backup routes - only accessible to authenticated users
router.post('/backup', authenticateToken, standardLimiter, createBackup);
router.post(
  '/restore',
  authenticateToken,
  standardLimiter,
  validateRequest(backupRestoreSchema),
  restoreBackup,
);
router.get('/backups', authenticateToken, listBackups);

export default router;

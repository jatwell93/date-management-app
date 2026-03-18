import { Router } from 'express';
import {
  createBackup,
  restoreBackup,
  listBackups,
} from '../controllers/database.backup.controller';
import { authenticateToken, requireManager } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { backupRestoreSchema } from '../schemas';
import { standardLimiter } from '../middleware/rateLimiter';

const router = Router();

// Database backup routes - restricted to manager/admin users
router.post('/backup', authenticateToken, requireManager, standardLimiter, createBackup);
router.post(
  '/restore',
  authenticateToken,
  requireManager,
  standardLimiter,
  validateRequest(backupRestoreSchema),
  restoreBackup,
);
router.get('/backups', authenticateToken, requireManager, listBackups);

export default router;

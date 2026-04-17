import { Router } from 'express';
import {
  createBackup,
  restoreBackup,
  listBackups,
} from '../controllers/database.backup.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/requireOrgRole';
import { validateRequest } from '../middleware/validateRequest';
import { backupRestoreSchema } from '../schemas';
import { standardLimiter } from '../middleware/rateLimiter';

const router = Router();

// Database backup routes - restricted to manager/admin users
router.post('/backup', authenticateToken, requireOrgRole('admin'), standardLimiter, createBackup);
router.post(
  '/restore',
  authenticateToken,
  requireOrgRole('admin'),
  standardLimiter,
  validateRequest(backupRestoreSchema),
  restoreBackup,
);
router.get('/backups', authenticateToken, requireOrgRole('admin'), listBackups);

export default router;

import { Router } from 'express';
import { createBackup, restoreBackup, listBackups } from '../controllers/database.backup.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Database backup routes - only accessible to authenticated users
router.post('/backup', authenticateToken, createBackup);
router.post('/restore', authenticateToken, restoreBackup);
router.get('/backups', authenticateToken, listBackups);

export default router;
import { Router, Response } from 'express';
import { createHealthController } from '../controllers/health.controller';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/requireOrgRole';

const router = Router();
const healthController = createHealthController();

/**
 * Initialize tier feature flags validation at boot time
 * Call this during application startup
 */
export async function initializeTierFlagValidation(): Promise<void> {
  await healthController.initializeTierFlagValidation();
}

/**
 * Re-validate tier feature flags (for health check refreshes)
 */
export async function revalidateTierFlags(): Promise<boolean> {
  return healthController.revalidateTierFlags();
}

// Health check endpoint
router.get('/health', async (req: AuthRequest, res: Response) => {
  await healthController.getHealth(req, res);
});

// Liveness probe (same as health for now, but can be extended)
router.get('/live', (req: AuthRequest, res: Response) => {
  healthController.getLive(req, res);
});

// Readiness probe (checks if the service is ready to accept traffic)
router.get('/ready', async (req: AuthRequest, res: Response) => {
  await healthController.getReady(req, res);
});

// Metrics endpoint for basic server info
router.get('/metrics', authenticateToken, requireOrgRole('admin'), (req: AuthRequest, res) => {
  healthController.getMetrics(req, res);
});

// Database metrics endpoint
router.get(
  '/database-metrics',
  authenticateToken,
  requireOrgRole('admin'),
  (req: AuthRequest, res: Response) => {
    healthController.getDatabaseMetrics(req, res);
  },
);

// Database health check endpoint
router.get(
  '/database-health',
  authenticateToken,
  requireOrgRole('admin'),
  (req: AuthRequest, res: Response) => {
    healthController.getDatabaseHealth(req, res);
  },
);

// Recent alerts endpoint
router.get(
  '/recent-alerts',
  authenticateToken,
  requireOrgRole('admin'),
  (req: AuthRequest, res: Response) => {
    healthController.getRecentAlerts(req, res);
  },
);

export default router;

import { Router } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/requireOrgRole';
import { createAdminMetricsController } from '../controllers/admin-metrics.controller';

const router = Router();
const adminMetricsController = createAdminMetricsController();

router.get('/dashboard', requireOrgRole('admin'), (req: AuthRequest, res, next) =>
  adminMetricsController.getDashboard(req, res, next),
);

router.get('/subscription-tiers', requireOrgRole('admin'), (req: AuthRequest, res, next) =>
  adminMetricsController.getSubscriptionTiers(req, res, next),
);

router.get('/revenue-projections', requireOrgRole('admin'), (req: AuthRequest, res, next) =>
  adminMetricsController.getRevenueProjections(req, res, next),
);

router.get('/historical', requireOrgRole('admin'), (req: AuthRequest, res, next) =>
  adminMetricsController.getHistorical(req, res, next),
);

router.get('/alerts', requireOrgRole('admin'), (req: AuthRequest, res, next) =>
  adminMetricsController.getAlerts(req, res, next),
);

export default router;

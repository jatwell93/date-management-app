import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { createDashboardController } from '../controllers/dashboard.controller';

const router = Router();
const dashboardController = createDashboardController();

router.get('/', authenticateToken, (req: AuthRequest, res, next) =>
  dashboardController.getDashboardData(req, res, next),
);

export default router;

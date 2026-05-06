import { Router, Response, NextFunction } from 'express';
import { ServiceProvider } from '../services/service-provider';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

function getDashboardServiceForRequest(req: AuthRequest) {
  return new ServiceProvider({ organizationId: req.organizationId }).getDashboardService();
}

router.get('/', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dashboardService = getDashboardServiceForRequest(req);
    const dashboardData = await dashboardService.getDashboardData();
    res.json(dashboardData);
  } catch (error) {
    next(error);
  }
});

export default router;

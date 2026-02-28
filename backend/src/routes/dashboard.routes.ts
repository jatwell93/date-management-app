import { Router, Request, Response } from 'express';
import { DashboardService } from '../services/dashboard.service';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Helper function to get services with organization context
function getDashboardServiceForRequest(req: AuthRequest) {
  // Note: DashboardService needs to be refactored to accept organizationId
  // For now, we'll instantiate it without organizationId
  return new DashboardService();
}

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const dashboardService = getDashboardServiceForRequest(req);
    const dashboardData = await dashboardService.getDashboardData();
    res.json(dashboardData);
  } catch (_error) {
    // console.error("Get dashboard data error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;

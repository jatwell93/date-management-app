import { Router, Request, Response } from 'express';
import { DashboardService } from '../services/dashboard.service';

const router = Router();
const dashboardService = new DashboardService();

router.get('/', async (req: Request, res: Response) => {
  try {
    const dashboardData = await dashboardService.getDashboardData();
    res.json(dashboardData);
  } catch (_error) {
    // console.error("Get dashboard data error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;

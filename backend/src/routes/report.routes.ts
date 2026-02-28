import { Router, Request, Response } from 'express';
import validator from 'validator';
import { ServiceProvider } from '../services/service-provider';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/feature-gate.middleware';

const router = Router();

// Helper function to get services with organization context
function getServicesForRequest(req: AuthRequest) {
  const serviceProvider = new ServiceProvider({ organizationId: req.organizationId });
  const reportService = serviceProvider.getReportService();
  return { reportService };
}

// GET /reports/expiry - Get monthly expiry report (FR-004)
router.get('/expiry', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getMonthlyExpiryReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get monthly expiry report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/expiry-overall - Get overall expiry report with all time counts
router.get('/expiry-overall', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getOverallExpiryReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get overall expiry report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/expiry-details - Get detailed expiry report for next 90 days
router.get('/expiry-details', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getDetailedExpiryReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get detailed expiry report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/monthly-markdown - Get monthly markdown report
router.get('/monthly-markdown', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getMonthlyMarkdownReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get monthly markdown report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /reports/update-statuses - Manually update all inventory markdown statuses
router.post('/update-statuses', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    await reportService.updateAllMarkdownStatuses();
    res.json({ message: 'All inventory markdown statuses updated successfully.' });
  } catch (_error) {
    // console.error("Update markdown statuses error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/usage - Get usage report (FR-009)
router.get('/usage', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getUsageReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get usage report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/daily-usage - Get daily usage report for past 90 days
router.get('/daily-usage', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getDailyUsageReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get daily usage report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/loss-by-sku - Get loss report by SKU
router.get('/loss-by-sku', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getLossBySkuReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get loss by SKU report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/loss-by-department - Get loss report by department
router.get('/loss-by-department', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getLossByDepartmentReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get loss by department report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/items-by-user - Get items added by user
router.get('/items-by-user', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const timeFrame = req.query.timeFrame as string | undefined;
    if (timeFrame && !validator.isInt(timeFrame, { min: 1, max: 3650 })) {
      return res.status(400).json({ message: 'Invalid timeFrame value' });
    }
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getItemsByUserReport(timeFrame);
    res.json(report);
  } catch (_error) {
    // console.error("Get items by user report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/items-by-date - Get items added by date
router.get('/items-by-date', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reportService } = getServicesForRequest(req);
    const report = await reportService.getItemsByDateReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get items by date report error:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /dashboard/analytics - Get dashboard analytics data (FR-005)
router.get(
  '/analytics',
  authenticateToken,
  requireFeature('advanced_analytics'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { reportService } = getServicesForRequest(req);
      const analytics = await reportService.getDashboardAnalytics();
      res.json(analytics);
    } catch (_error) {
      // console.error("Get dashboard analytics error:", _error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

export default router;

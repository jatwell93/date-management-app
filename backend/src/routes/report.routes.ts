import { Router, Response, NextFunction } from 'express';
import { createReportController } from '../controllers/report.controller';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/feature-gate.middleware';

const router = Router();
const reportController = createReportController();

// GET /reports/expiry - Get monthly expiry report (FR-004)
router.get(
  '/expiry',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getMonthlyExpiryReport(req, res, next);
  },
);

// GET /reports/expiry-overall - Get overall expiry report with all time counts
router.get(
  '/expiry-overall',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getOverallExpiryReport(req, res, next);
  },
);

// GET /reports/expiry-details - Get detailed expiry report for next 90 days
router.get(
  '/expiry-details',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getDetailedExpiryReport(req, res, next);
  },
);

// GET /reports/expiry-entries - Get all active (non-expired) expiry entries
router.get(
  '/expiry-entries',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getActiveExpiryEntriesReport(req, res, next);
  },
);

// GET /reports/monthly-markdown - Get monthly markdown report
router.get(
  '/monthly-markdown',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getMonthlyMarkdownReport(req, res, next);
  },
);

// POST /reports/update-statuses - Manually update all inventory markdown statuses
router.post(
  '/update-statuses',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.updateAllMarkdownStatuses(req, res, next);
  },
);

// GET /reports/usage - Get usage report (FR-009)
router.get(
  '/usage',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getUsageReport(req, res, next);
  },
);

// GET /reports/daily-usage - Get daily usage report for past 90 days
router.get(
  '/daily-usage',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getDailyUsageReport(req, res, next);
  },
);

// GET /reports/loss-by-sku - Get loss report by SKU
router.get(
  '/loss-by-sku',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getLossBySkuReport(req, res, next);
  },
);

// GET /reports/loss-by-department - Get loss report by department
router.get(
  '/loss-by-department',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getLossByDepartmentReport(req, res, next);
  },
);

// GET /reports/sell-through - Sell-through counts by markdown level
router.get(
  '/sell-through',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getSellThroughReport(req, res, next);
  },
);

// GET /reports/items-by-user - Get items added by user
router.get(
  '/items-by-user',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getItemsByUserReport(req, res, next);
  },
);

// GET /reports/items-by-date - Get items added by date
router.get(
  '/items-by-date',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getItemsByDateReport(req, res, next);
  },
);

// GET /reports/store-walk-audit - Get store walk checking productivity and flags
router.get(
  '/store-walk-audit',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getStoreWalkAuditReport(req, res, next);
  },
);

// GET /dashboard/analytics - Get dashboard analytics data (FR-005)
router.get(
  '/analytics',
  authenticateToken,
  requireFeature('advanced_analytics'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    await reportController.getDashboardAnalytics(req, res, next);
  },
);

export default router;

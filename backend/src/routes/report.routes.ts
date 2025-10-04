import { Router, Request, Response } from "express";
import { ReportService } from "../services/report.service";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
const reportService = new ReportService();

// GET /reports/expiry - Get monthly expiry report (FR-004)
router.get(
  "/expiry",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const report = await reportService.getMonthlyExpiryReport();
      res.json(report);
    } catch (_error) {
      // console.error("Get monthly expiry report error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /reports/expiry-details - Get detailed expiry report for next 90 days
router.get(
  "/expiry-details",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const report = await reportService.getDetailedExpiryReport();
      res.json(report);
    } catch (_error) {
      // console.error("Get detailed expiry report error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /reports/monthly-markdown - Get monthly markdown report
router.get(
  "/monthly-markdown",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const report = await reportService.getMonthlyMarkdownReport();
      res.json(report);
    } catch (_error) {
      // console.error("Get monthly markdown report error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /reports/usage - Get usage report (FR-009)
router.get("/usage", authenticateToken, async (req: Request, res: Response) => {
  try {
    const report = await reportService.getUsageReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get usage report error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /reports/daily-usage - Get daily usage report for past 90 days
router.get("/daily-usage", authenticateToken, async (req: Request, res: Response) => {
  try {
    const report = await reportService.getDailyUsageReport();
    res.json(report);
  } catch (_error) {
    // console.error("Get daily usage report error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /dashboard/analytics - Get dashboard analytics data (FR-005)
router.get(
  "/analytics",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const analytics = await reportService.getDashboardAnalytics();
      res.json(analytics);
    } catch (_error) {
      // console.error("Get dashboard analytics error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default router;

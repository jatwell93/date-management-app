"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const report_service_1 = require("../services/report.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const reportService = new report_service_1.ReportService();
// GET /reports/expiry - Get monthly expiry report (FR-004)
router.get("/expiry", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getMonthlyExpiryReport();
        res.json(report);
    }
    catch (_error) {
        // console.error("Get monthly expiry report error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /reports/expiry-overall - Get overall expiry report with all time counts
router.get("/expiry-overall", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getOverallExpiryReport();
        res.json(report);
    }
    catch (_error) {
        // console.error("Get overall expiry report error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /reports/expiry-details - Get detailed expiry report for next 90 days
router.get("/expiry-details", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getDetailedExpiryReport();
        res.json(report);
    }
    catch (_error) {
        // console.error("Get detailed expiry report error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /reports/monthly-markdown - Get monthly markdown report
router.get("/monthly-markdown", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getMonthlyMarkdownReport();
        res.json(report);
    }
    catch (_error) {
        // console.error("Get monthly markdown report error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// POST /reports/update-statuses - Manually update all inventory markdown statuses
router.post("/update-statuses", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        await reportService.updateAllMarkdownStatuses();
        res.json({ message: "All inventory markdown statuses updated successfully." });
    }
    catch (_error) {
        // console.error("Update markdown statuses error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /reports/usage - Get usage report (FR-009)
router.get("/usage", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getUsageReport();
        res.json(report);
    }
    catch (_error) {
        // console.error("Get usage report error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /reports/daily-usage - Get daily usage report for past 90 days
router.get("/daily-usage", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getDailyUsageReport();
        res.json(report);
    }
    catch (_error) {
        // console.error("Get daily usage report error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /dashboard/analytics - Get dashboard analytics data (FR-005)
router.get("/analytics", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const analytics = await reportService.getDashboardAnalytics();
        res.json(analytics);
    }
    catch (_error) {
        // console.error("Get dashboard analytics error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

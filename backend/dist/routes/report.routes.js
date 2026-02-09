"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validator_1 = __importDefault(require("validator"));
const service_provider_1 = require("../services/service-provider");
const auth_middleware_1 = require("../middleware/auth.middleware");
const normalize_function_1 = require("../utils/normalize.function");
const router = (0, express_1.Router)();
const serviceProvider = new service_provider_1.ServiceProvider();
const reportService = serviceProvider.getReportService();
// GET /reports/expiry - Get monthly expiry report (FR-004)
router.get('/expiry', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getMonthlyExpiryReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get monthly expiry report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/expiry-overall - Get overall expiry report with all time counts
router.get('/expiry-overall', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getOverallExpiryReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get overall expiry report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/expiry-details - Get detailed expiry report for next 90 days
router.get('/expiry-details', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getDetailedExpiryReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get detailed expiry report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/monthly-markdown - Get monthly markdown report
router.get('/monthly-markdown', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getMonthlyMarkdownReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get monthly markdown report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /reports/update-statuses - Manually update all inventory markdown statuses
router.post('/update-statuses', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        await reportService.updateAllMarkdownStatuses();
        res.json((0, normalize_function_1.escapeHtml)({ message: 'All inventory markdown statuses updated successfully.' }));
    }
    catch (_error) {
        // console.error("Update markdown statuses error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/usage - Get usage report (FR-009)
router.get('/usage', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getUsageReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get usage report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/daily-usage - Get daily usage report for past 90 days
router.get('/daily-usage', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getDailyUsageReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get daily usage report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/loss-by-sku - Get loss report by SKU
router.get('/loss-by-sku', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getLossBySkuReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get loss by SKU report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/loss-by-department - Get loss report by department
router.get('/loss-by-department', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getLossByDepartmentReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get loss by department report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/items-by-user - Get items added by user
router.get('/items-by-user', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const timeFrame = req.query.timeFrame;
        if (timeFrame && !validator_1.default.isInt(timeFrame, { min: 1, max: 3650 })) {
            return res.status(400).json({ message: 'Invalid timeFrame value' });
        }
        const report = await reportService.getItemsByUserReport(timeFrame);
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get items by user report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /reports/items-by-date - Get items added by date
router.get('/items-by-date', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const report = await reportService.getItemsByDateReport();
        res.json((0, normalize_function_1.escapeHtml)(report));
    }
    catch (_error) {
        // console.error("Get items by date report error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /dashboard/analytics - Get dashboard analytics data (FR-005)
router.get('/analytics', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const analytics = await reportService.getDashboardAnalytics();
        res.json((0, normalize_function_1.escapeHtml)(analytics));
    }
    catch (_error) {
        // console.error("Get dashboard analytics error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.default = router;

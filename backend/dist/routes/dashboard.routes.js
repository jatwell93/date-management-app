"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_service_1 = require("../services/dashboard.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Helper function to get services with organization context
function getDashboardServiceForRequest(req) {
    // Note: DashboardService needs to be refactored to accept organizationId
    // For now, we'll instantiate it without organizationId
    return new dashboard_service_1.DashboardService();
}
router.get('/', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const dashboardService = getDashboardServiceForRequest(req);
        const dashboardData = await dashboardService.getDashboardData();
        res.json(dashboardData);
    }
    catch (_error) {
        // console.error("Get dashboard data error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_service_1 = require("../services/dashboard.service");
const router = (0, express_1.Router)();
const dashboardService = new dashboard_service_1.DashboardService();
router.get("/", async (req, res) => {
    try {
        const dashboardData = await dashboardService.getDashboardData();
        res.json(dashboardData);
    }
    catch (_error) {
        // console.error("Get dashboard data error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

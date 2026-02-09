"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportService = void 0;
const report_repository_1 = require("../repositories/report.repository");
const scheduler_service_1 = require("./scheduler.service");
/**
 * Report Service with Dependency Injection
 * Generates various reports for inventory management and analytics
 *
 * Task 8.4 & 8.6: Refactored to use DI pattern with repository
 */
class ReportService {
    /**
     * Constructor with dependency injection
     * @param db Database instance (injected)
     */
    constructor(db) {
        this.db = db;
        this.repository = new report_repository_1.ReportRepository(db);
    }
    async getMonthlyExpiryReport() {
        return this.repository.getMonthlyExpiryReport();
    }
    async getOverallExpiryReport() {
        return this.repository.getOverallExpiryReport();
    }
    async getDetailedExpiryReport() {
        return this.repository.getDetailedExpiryReport();
    }
    async getMonthlyMarkdownReport() {
        return this.repository.getMonthlyMarkdownReport();
    }
    async getUsageReport() {
        return this.repository.getUsageReport();
    }
    async getDailyUsageReport() {
        return this.repository.getDailyUsageReport();
    }
    async getDashboardAnalytics() {
        return this.repository.getDashboardAnalytics();
    }
    async updateAllMarkdownStatuses() {
        return scheduler_service_1.SchedulerService.updateAllInventoryMarkdownStatuses();
    }
    async getLossBySkuReport() {
        return this.repository.getLossBySkuReport();
    }
    async getLossByDepartmentReport() {
        return this.repository.getLossByDepartmentReport();
    }
    async getItemsByUserReport(timeFrame) {
        return this.repository.getItemsByUserReport(timeFrame);
    }
    async getItemsByDateReport() {
        return this.repository.getItemsByDateReport();
    }
}
exports.ReportService = ReportService;

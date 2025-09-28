"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const database_1 = require("./database");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const product_routes_1 = __importDefault(require("./routes/product.routes"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const report_routes_1 = __importDefault(require("./routes/report.routes"));
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const store_area_routes_1 = __importDefault(require("./routes/store-area.routes"));
const auth_middleware_1 = require("./middleware/auth.middleware");
const error_middleware_1 = require("./middleware/error.middleware");
const scheduler_service_1 = require("./services/scheduler.service");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = 3001;
// Middleware
app.use(express_1.default.json());
app.use((0, cors_1.default)()); // Enable CORS
// Initialize database
(0, database_1.initDatabase)().catch((_err) => {
    // console.error("Database initialization failed", _err);
});
// Initialize scheduled tasks
scheduler_service_1.SchedulerService.initialize();
// Public routes
app.use("/auth", auth_routes_1.default);
// Protected routes
app.use("/products", auth_middleware_1.authenticateToken, product_routes_1.default);
app.use("/inventory-items", auth_middleware_1.authenticateToken, inventory_routes_1.default);
app.use("/store-areas", auth_middleware_1.authenticateToken, store_area_routes_1.default);
app.use("/reports", auth_middleware_1.authenticateToken, report_routes_1.default);
app.use("/dashboard", auth_middleware_1.authenticateToken, dashboard_routes_1.default);
app.use("/users", auth_middleware_1.authenticateToken, user_routes_1.default);
app.get("/", (req, res) => {
    res.json({ message: "Date Management API is running!" });
});
// Error handling middleware
app.use(error_middleware_1.errorHandler);
if (process.env.NODE_ENV !== "test") {
    app.listen(port, () => {
        // console.log(`Server is running on http://localhost:${port}`);
    });
}
exports.default = app;

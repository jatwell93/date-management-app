import express from "express";
import cors from "cors";
import { initDatabase } from "./database";
import authRoutes from "./routes/auth.routes";
import productRoutes from "./routes/product.routes";
import inventoryRoutes from "./routes/inventory.routes";
import reportRoutes from "./routes/report.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import userRoutes from "./routes/user.routes";
import storeAreaRoutes from "./routes/store-area.routes";
import { authenticateToken } from "./middleware/auth.middleware";
import { errorHandler } from "./middleware/error.middleware";

const app = express();
const port = 3001;

// Middleware
app.use(express.json());
app.use(cors()); // Enable CORS

// Initialize database
initDatabase().catch((_err) => {
  // console.error("Database initialization failed", _err);
});

// Public routes
app.use("/auth", authRoutes);

// Protected routes
app.use("/products", authenticateToken, productRoutes);
app.use("/inventory-items", authenticateToken, inventoryRoutes);
app.use("/store-areas", authenticateToken, storeAreaRoutes);
app.use("/reports", authenticateToken, reportRoutes);
app.use("/dashboard", authenticateToken, dashboardRoutes);
app.use("/users", authenticateToken, userRoutes);

app.get("/", (req, res) => {
  res.send("Date Management API is running!");
});

// Error handling middleware
app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    // console.log(`Server is running on http://localhost:${port}`);
  });
}

export default app;

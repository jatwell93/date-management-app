"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireManager = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token == null)
        return res.status(401).json({ message: "Access denied: No token provided" }); // No token
    jsonwebtoken_1.default.verify(token, "your_jwt_secret", // It's better to use an environment variable here, e.g., process.env.JWT_SECRET
    (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Access denied: Invalid token" }); // Token is invalid (e.g., expired, wrong signature)
        }
        // FIX: Add a check to ensure the user payload exists and is an object
        if (!user || typeof user === 'string') {
            return res.status(403).json({ message: "Access denied: Invalid token payload" }); // Token is valid, but payload is missing or in wrong format
        }
        // Now that we've checked, we can safely access the properties
        req.userId = user.userId;
        req.userRole = user.role;
        req.user = {
            id: user.userId,
            role: user.role
        };
        next();
    });
};
exports.authenticateToken = authenticateToken;
const requireManager = (req, res, next) => {
    if (req.userRole !== "Manager") {
        return res
            .status(403)
            .json({ message: "Access denied: Manager role required" });
    }
    next();
};
exports.requireManager = requireManager;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireManager = exports.generateToken = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const analytics_service_1 = require("../services/analytics.service");
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token == null) {
        // Track unauthorized access attempt
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'unauthorized_access_attempt',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method }
        });
        return res.status(401).json({ message: "Access denied: No token provided" }); // No token
    }
    // Check for valid token with current secret, and if that fails, check with old secret for rotation
    let decodedToken;
    let verificationError = null;
    // First try with the current JWT secret
    try {
        decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    }
    catch (err) {
        // If current secret fails, try with old secret (for rotation period)
        if (process.env.JWT_SECRET_OLD) {
            try {
                decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET_OLD);
            }
            catch (rotationErr) {
                // Both secrets failed, return unauthorized
                // Track invalid token attempt
                const analyticsService = analytics_service_1.AnalyticsService.getInstance();
                analyticsService.trackEvent({
                    eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                    eventCategory: 'Auth',
                    eventAction: 'invalid_token_attempt',
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent') || undefined,
                    metadata: { path: req.path, method: req.method }
                });
                return res.status(403).json({ message: "Access denied: Invalid token" });
            }
        }
        else {
            // Only current secret was available and it failed
            // Track invalid token attempt
            const analyticsService = analytics_service_1.AnalyticsService.getInstance();
            analyticsService.trackEvent({
                eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                eventCategory: 'Auth',
                eventAction: 'invalid_token_attempt',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent') || undefined,
                metadata: { path: req.path, method: req.method }
            });
            return res.status(403).json({ message: "Access denied: Invalid token" });
        }
    }
    // FIX: Add a check to ensure the decoded token payload exists and is an object
    if (!decodedToken || typeof decodedToken === 'string') {
        // Track invalid token payload
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'invalid_token_payload',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method }
        });
        return res.status(403).json({ message: "Access denied: Invalid token payload" }); // Token is valid, but payload is missing or in wrong format
    }
    // Check for token expiration (manually if not automatically handled by jwt.verify)
    if (decodedToken.exp && decodedToken.exp * 1000 < Date.now()) {
        // Track expired token attempt
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'expired_token_attempt',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method }
        });
        return res.status(403).json({ message: "Access denied: Token has expired" });
    }
    // Now that we've verified, we can safely access the properties
    req.userId = decodedToken.userId;
    req.userRole = decodedToken.role;
    req.user = {
        id: decodedToken.userId,
        role: decodedToken.role
    };
    // Track successful authenticated request
    const analyticsService = analytics_service_1.AnalyticsService.getInstance();
    analyticsService.trackEvent({
        userId: decodedToken.userId,
        eventType: analytics_service_1.AnalyticsEventType.VIEW_DASHBOARD, // General action for accessing protected routes
        eventCategory: 'Auth',
        eventAction: 'protected_route_access',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: { path: req.path, method: req.method, role: decodedToken.role }
    });
    next();
};
exports.authenticateToken = authenticateToken;
// Function to generate a JWT token with configurable expiration
const generateToken = (userId, role, expiresIn = '24h') => {
    return jsonwebtoken_1.default.sign({ userId, role }, process.env.JWT_SECRET || "your_jwt_secret");
};
exports.generateToken = generateToken;
const requireManager = (req, res, next) => {
    if (req.userRole !== "Manager") {
        // Track unauthorized manager access attempt
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            userId: req.userId,
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'manager_access_denied',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method, role: req.userRole }
        });
        return res
            .status(403)
            .json({ message: "Access denied: Manager role required" });
    }
    next();
};
exports.requireManager = requireManager;

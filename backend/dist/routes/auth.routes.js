"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validator_1 = __importDefault(require("validator"));
const auth_service_1 = require("../services/auth.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validateRequest_1 = require("../middleware/validateRequest");
const schemas_1 = require("../schemas");
const rateLimiter_1 = require("../middleware/rateLimiter");
const errors_1 = require("../errors");
const router = (0, express_1.Router)();
const authService = new auth_service_1.AuthService();
const normalizePin = (req, _res, next) => {
    if (req.body?.pin !== undefined && req.body?.pin !== null) {
        req.body.pin = String(req.body.pin);
    }
    next();
};
router.post('/login', rateLimiter_1.strictLimiter, normalizePin, (0, validateRequest_1.validateRequest)(schemas_1.loginSchema), async (req, res) => {
    const rawPin = req.body.pin;
    const pin = rawPin ? validator_1.default.whitelist(rawPin, '0-9') : '';
    if (!pin) {
        return res.status(400).json({ message: 'PIN is required' });
    }
    if (rawPin && pin !== rawPin) {
        return res.status(400).json({ message: 'PIN must contain only digits' });
    }
    // Validate PIN strength
    const pinValidation = authService.validatePin(pin);
    if (!pinValidation.isValid) {
        return res.status(400).json({ message: pinValidation.message });
    }
    try {
        // For this implementation, we're using direct PIN comparison.
        // In a real application, you would properly compare hashes
        const authResult = await authService.login(pin);
        res.json(authResult);
    }
    catch (error) {
        if (error instanceof errors_1.AuthenticationError) {
            return res.status(401).json({ message: error.message });
        }
        // console.error("Login error:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// Token refresh endpoint
router.post('/refresh', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        // Regenerate token with updated expiration
        const authReq = req; // Using 'any' to access custom properties added by auth middleware
        if (!authReq.userId || !authReq.userRole || !authReq.organizationId || !authReq.tierLevel) {
            return res.status(401).json({ message: 'User not authenticated' });
        }
        const newToken = (0, auth_middleware_1.generateToken)(authReq.userId, authReq.userRole, authReq.organizationId, authReq.tierLevel, '1h');
        res.json({ token: newToken });
    }
    catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.default = router;

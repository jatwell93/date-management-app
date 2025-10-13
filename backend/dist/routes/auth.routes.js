"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_service_1 = require("../services/auth.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const authService = new auth_service_1.AuthService();
router.post("/login", async (req, res) => {
    const { pin } = req.body;
    if (!pin) {
        return res.status(400).json({ message: "PIN is required" });
    }
    // Validate PIN strength
    const pinValidation = authService.validatePin(pin);
    if (!pinValidation.isValid) {
        return res.status(400).json({ message: pinValidation.message });
    }
    try {
        // For this implementation, we're using direct PIN comparison.
        // In a real application, you would properly compare hashes
        const token = await authService.login(pin);
        if (token) {
            res.json({ token });
        }
        else {
            res.status(401).json({ message: "Invalid PIN" });
        }
    }
    catch (_error) {
        // console.error("Login error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// Token refresh endpoint
router.post("/refresh", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        // Regenerate token with updated expiration
        const { userId, userRole } = req; // Using 'any' to access custom properties added by auth middleware
        if (!userId || !userRole) {
            return res.status(401).json({ message: "User not authenticated" });
        }
        const newToken = (0, auth_middleware_1.generateToken)(userId, userRole, '1h');
        res.json({ token: newToken });
    }
    catch (error) {
        console.error("Token refresh error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

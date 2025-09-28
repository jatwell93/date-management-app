"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_service_1 = require("../services/auth.service");
const router = (0, express_1.Router)();
const authService = new auth_service_1.AuthService();
router.post("/login", async (req, res) => {
    const { pin } = req.body;
    if (!pin) {
        return res.status(400).json({ message: "PIN is required" });
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
exports.default = router;

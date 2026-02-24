"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const clerk_auth_middleware_1 = require("../middleware/clerk-auth.middleware");
const router = (0, express_1.Router)();
// POST /auth/logout
// Clerk manages session invalidation client-side (clear the JWT).
// This endpoint exists for clients that want a server-side logout acknowledgement.
router.post('/logout', clerk_auth_middleware_1.clerkAuth, (_req, res) => {
    res.status(200).json({ message: 'Logged out successfully' });
});
exports.default = router;

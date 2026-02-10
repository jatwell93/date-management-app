"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_service_1 = require("../services/user.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const validateRequest_1 = require("../middleware/validateRequest");
const schemas_1 = require("../schemas");
const data_integrity_middleware_1 = require("../middleware/data-integrity.middleware");
const normalize_function_1 = require("../utils/normalize.function");
const rateLimiter_1 = require("../middleware/rateLimiter");
const feature_gate_middleware_1 = require("../middleware/feature-gate.middleware");
const router = (0, express_1.Router)();
const userService = new user_service_1.UserService();
// GET /users - Get all users (Manager only)
router.get('/', auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        // const users = await userService.getUsers();
        const users = await userService.getUsers( /* req.organizationId */);
        res.json((0, normalize_function_1.escapeHtml)(users));
    }
    catch (_error) {
        // console.error("Error getting users:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /users/:id - Get a specific user by ID (Manager only)
router.get('/:id', auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        const user = await userService.getUserById(id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Validate ownership: user.organization_id must match req.organizationId
        if (user.organizationId !== req.organizationId) {
            return res.status(403).json({ message: 'Access denied: User belongs to different organization' });
        }
        res.json((0, normalize_function_1.escapeHtml)(user));
    }
    catch (_error) {
        // console.error("Error getting user:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /users - Create a new user (Manager only)
router.post('/', auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, (0, feature_gate_middleware_1.checkUsageLimit)('max_users'), rateLimiter_1.standardLimiter, (0, validateRequest_1.validateRequest)(schemas_1.userSchema), validation_middleware_1.validateDataIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    try {
        const { pin, role } = req.body;
        if (!pin || !role) {
            return res.status(400).json({ message: 'PIN and role are required' });
        }
        // Validate organization context
        if (!req.organizationId) {
            return res.status(401).json({ message: 'Access denied: No organization context found' });
        }
        // FIX: Use Omit to create a type that represents a user *before* it's saved to the DB.
        const newUser = {
            pin,
            role,
            organizationId: req.organizationId, // Use req.organizationId from auth context
        };
        const createdUser = await userService.createUser(newUser);
        res.status(201).json((0, normalize_function_1.escapeHtml)(createdUser));
    }
    catch (_error) {
        // console.error("Error creating user:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// PUT /users/:id - Update a user (Manager only)
router.put('/:id', auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, rateLimiter_1.standardLimiter, (0, validateRequest_1.validateRequest)(schemas_1.userSchema), validation_middleware_1.validateDataIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        // First, get the user to validate ownership
        const existingUser = await userService.getUserById(id);
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Validate ownership: user.organization_id must match req.organizationId
        if (existingUser.organizationId !== req.organizationId) {
            return res.status(403).json({ message: 'Access denied: User belongs to different organization' });
        }
        const { pin, role } = req.body;
        const user = {};
        if (pin !== undefined)
            user.pin = pin;
        if (role !== undefined)
            user.role = role;
        const updated = await userService.updateUser(id, user);
        if (!updated) {
            return res.status(404).json({ message: 'User not found' });
        }
        const updatedUser = await userService.getUserById(id);
        res.json((0, normalize_function_1.escapeHtml)(updatedUser));
    }
    catch (_error) {
        // console.error("Error updating user:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// DELETE /users/:id - Delete a user (Manager only)
router.delete('/:id', auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, rateLimiter_1.standardLimiter, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        // First, get the user to validate ownership
        const existingUser = await userService.getUserById(id);
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Validate ownership: user.organization_id must match req.organizationId
        if (existingUser.organizationId !== req.organizationId) {
            return res.status(403).json({ message: 'Access denied: User belongs to different organization' });
        }
        const deleted = await userService.deleteUser(id);
        if (!deleted) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json((0, normalize_function_1.escapeHtml)({ message: 'User deleted successfully' }));
    }
    catch (_error) {
        // console.error("Error deleting user:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.default = router;

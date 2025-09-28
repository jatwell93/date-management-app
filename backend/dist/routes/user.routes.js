"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_service_1 = require("../services/user.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// GET /users - Get all users (Manager only)
router.get("/", auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        const users = await (0, user_service_1.getUsers)();
        res.json(users);
    }
    catch (_error) {
        // console.error("Error getting users:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /users/:id - Get a specific user by ID (Manager only)
router.get("/:id", auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const user = await (0, user_service_1.getUserById)(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
    }
    catch (_error) {
        // console.error("Error getting user:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// POST /users - Create a new user (Manager only)
router.post("/", auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        const { pin, role } = req.body;
        if (!pin || !role) {
            return res.status(400).json({ message: "PIN and role are required" });
        }
        // FIX: Use Omit to create a type that represents a user *before* it's saved to the DB.
        const newUser = {
            pin,
            role,
        };
        const createdUser = await (0, user_service_1.createUser)(newUser);
        res.status(201).json(createdUser);
    }
    catch (_error) {
        // console.error("Error creating user:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// PUT /users/:id - Update a user (Manager only)
router.put("/:id", auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { pin, role } = req.body;
        const user = {};
        if (pin !== undefined)
            user.pin = pin;
        if (role !== undefined)
            user.role = role;
        const updated = await (0, user_service_1.updateUser)(id, user);
        if (!updated) {
            return res.status(404).json({ message: "User not found" });
        }
        const updatedUser = await (0, user_service_1.getUserById)(id);
        res.json(updatedUser);
    }
    catch (_error) {
        // console.error("Error updating user:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// DELETE /users/:id - Delete a user (Manager only)
router.delete("/:id", auth_middleware_1.authenticateToken, auth_middleware_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await (0, user_service_1.deleteUser)(id);
        if (!deleted) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json({ message: "User deleted successfully" });
    }
    catch (_error) {
        // console.error("Error deleting user:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

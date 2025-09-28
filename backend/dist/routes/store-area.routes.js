"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_area_service_1 = require("../services/store-area.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const storeAreaService = new store_area_service_1.StoreAreaService();
// GET /store-areas - Get all store areas
router.get("/", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const areas = await storeAreaService.getAllStoreAreas();
        res.json(areas);
    }
    catch (_error) {
        // console.error("Get store areas error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /store-areas/:id - Get a specific store area by ID
router.get("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const area = await storeAreaService.getStoreAreaById(id);
        if (!area) {
            return res.status(404).json({ message: "Store area not found" });
        }
        res.json(area);
    }
    catch (_error) {
        // console.error("Get store area error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /store-areas/name/:name - Get a specific store area by name
router.get("/name/:name", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const name = req.params.name;
        const area = await storeAreaService.getStoreAreaByName(name);
        if (!area) {
            return res.status(404).json({ message: "Store area not found" });
        }
        res.json(area);
    }
    catch (_error) {
        // console.error("Get store area by name error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// POST /store-areas - Create a new store area
router.post("/", auth_middleware_1.authenticateToken, async (req, res) => {
    const { name, subDepartment, lastChecked } = req.body;
    if (!name) {
        return res
            .status(400)
            .json({ message: "Missing required store area fields" });
    }
    try {
        const newArea = await storeAreaService.createStoreArea({
            name,
            subDepartment,
            lastChecked,
        });
        res.status(201).json(newArea);
    }
    catch (_error) {
        // console.error("Create store area error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// PUT /store-areas/:id - Update a store area
router.put("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, subDepartment, lastChecked } = req.body;
        // Build update object
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (subDepartment !== undefined)
            updateData.subDepartment = subDepartment;
        if (lastChecked !== undefined)
            updateData.lastChecked = lastChecked;
        const updatedArea = await storeAreaService.updateStoreArea(id, updateData);
        if (!updatedArea) {
            return res.status(404).json({ message: "Store area not found" });
        }
        res.json(updatedArea);
    }
    catch (_error) {
        // console.error("Update store area error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// DELETE /store-areas/:id - Delete a store area
router.delete("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await storeAreaService.deleteStoreArea(id);
        if (!deleted) {
            return res.status(404).json({ message: "Store area not found" });
        }
        res.json({ message: "Store area deleted successfully" });
    }
    catch (_error) {
        // console.error("Delete store area error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_service_1 = require("../services/inventory.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const inventoryService = new inventory_service_1.InventoryService();
// GET /inventory-items - Get all inventory items
router.get("/", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const items = await inventoryService.getAllInventoryItems();
        res.json(items);
    }
    catch (_error) {
        // console.error("Get inventory items error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /inventory-items/:id - Get a specific inventory item by ID
router.get("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const item = await inventoryService.getInventoryItemById(id);
        if (!item) {
            return res.status(404).json({ message: "Inventory item not found" });
        }
        res.json(item);
    }
    catch (_error) {
        // console.error("Get inventory item error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /inventory-items/product/:productId - Get inventory items for a specific product
router.get("/product/:productId", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const productId = parseInt(req.params.productId);
        const items = await inventoryService.getInventoryItemsByProductId(productId);
        res.json(items);
    }
    catch (_error) {
        // console.error("Get inventory items by product error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /inventory-items/location/:locationId - Get inventory items for a specific location
router.get("/location/:locationId", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const locationId = parseInt(req.params.locationId);
        const items = await inventoryService.getInventoryItemsByLocationId(locationId);
        res.json(items);
    }
    catch (_error) {
        // console.error("Get inventory items by location error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// POST /inventory-items - Create a new inventory item
router.post("/", auth_middleware_1.authenticateToken, async (req, res) => {
    const { productId, expiryDate, locationId, status } = req.body;
    // Validate required fields
    if (productId === undefined || productId === null ||
        typeof productId !== 'number' || Number.isNaN(productId) || productId < 1 ||
        !expiryDate ||
        locationId === undefined || locationId === null ||
        typeof locationId !== 'number' || Number.isNaN(locationId) || locationId < 1) {
        return res
            .status(400)
            .json({ message: "Missing required inventory item fields" });
    }
    try {
        const newInventoryItem = await inventoryService.createInventoryItem({
            productId,
            expiryDate,
            locationId,
            status,
        });
        res.status(201).json(newInventoryItem);
    }
    catch (error) {
        // Check if the error is about location not existing
        if (error.message === "Location does not exist") {
            return res
                .status(400)
                .json({ message: "Location does not exist" });
        }
        // console.error("Create inventory item error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// PUT /inventory-items/:id - Update an inventory item
router.put("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { productId, expiryDate, locationId, status } = req.body;
        // Build update object
        const updateData = {};
        if (productId !== undefined)
            updateData.productId = productId;
        if (expiryDate !== undefined)
            updateData.expiryDate = expiryDate;
        if (locationId !== undefined)
            updateData.locationId = locationId;
        if (status !== undefined)
            updateData.status = status;
        const updatedItem = await inventoryService.updateInventoryItem(id, updateData);
        if (!updatedItem) {
            return res.status(404).json({ message: "Inventory item not found" });
        }
        res.json(updatedItem);
    }
    catch (_error) {
        // console.error("Update inventory item error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// DELETE /inventory-items/:id - Delete an inventory item
router.delete("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await inventoryService.deleteInventoryItem(id);
        if (!deleted) {
            return res.status(404).json({ message: "Inventory item not found" });
        }
        res.json({ message: "Inventory item deleted successfully" });
    }
    catch (_error) {
        // console.error("Delete inventory item error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

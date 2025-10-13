"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_service_1 = require("../services/inventory.service");
const product_service_1 = require("../services/product.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const data_integrity_middleware_1 = require("../middleware/data-integrity.middleware");
const router = (0, express_1.Router)();
const inventoryService = new inventory_service_1.InventoryService();
// GET /inventory-items - Get all inventory items
router.get("/", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const items = await inventoryService.getAllInventoryItems();
        res.json(items);
    }
    catch (error) {
        console.error("Get inventory items error:", error);
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
    catch (error) {
        console.error("Get inventory item error:", error);
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
    catch (error) {
        console.error("Get inventory items by product error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /inventory-items/by-barcode/:barcode - Get inventory items for a specific product by barcode
router.get("/by-barcode/:barcode", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const barcode = req.params.barcode;
        // First, get the product by barcode to get its ID
        const productService = new product_service_1.ProductService();
        const product = await productService.getProductByBarcode(barcode);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        // Then get inventory items for that product
        const items = await inventoryService.getInventoryItemsByProductId(product.id);
        res.json(items);
    }
    catch (error) {
        console.error("Get inventory items by barcode error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /inventory-items/recent/product/:productId - Get the most recent inventory items for a specific product
router.get("/recent/product/:productId", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const productId = parseInt(req.params.productId);
        const limit = parseInt(req.query.limit) || 5; // Default to 5 items if not specified
        const items = await inventoryService.getRecentInventoryItemsByProductId(productId, limit);
        res.json(items);
    }
    catch (error) {
        console.error("Get recent inventory items by product error:", error);
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
    catch (error) {
        console.error("Get inventory items by location error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// POST /inventory-items - Create a new inventory item
router.post("/", auth_middleware_1.authenticateToken, validation_middleware_1.validateInventoryItemInput, data_integrity_middleware_1.validateReferentialIntegrity, data_integrity_middleware_1.validateDataConsistency, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
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
        const userId = req.userId; // Get user ID from auth middleware
        if (!userId) {
            return res.status(401).json({ message: "Access denied: No user ID found" });
        }
        const newInventoryItem = await inventoryService.createInventoryItem({
            productId,
            expiryDate,
            locationId,
            status,
        }, userId);
        res.status(201).json(newInventoryItem);
    }
    catch (error) {
        // Check if the error is about location not existing
        if (error.message === "Location does not exist") {
            return res
                .status(400)
                .json({ message: "Location does not exist" });
        }
        console.error("Create inventory item error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// PUT /inventory-items/:id - Update an inventory item
router.put("/:id", auth_middleware_1.authenticateToken, validation_middleware_1.validateInventoryItemInput, data_integrity_middleware_1.validateReferentialIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { productId, expiryDate, locationId, status } = req.body;
        const userId = req.userId; // Get user ID from auth middleware
        if (!userId) {
            return res.status(401).json({ message: "Access denied: No user ID found" });
        }
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
        const updatedItem = await inventoryService.updateInventoryItem(id, updateData, userId);
        if (!updatedItem) {
            return res.status(404).json({ message: "Inventory item not found" });
        }
        res.json(updatedItem);
    }
    catch (error) {
        console.error("Update inventory item error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// DELETE /inventory-items/:id - Delete an inventory item
router.delete("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const userId = req.userId; // Get user ID from auth middleware
        if (!userId) {
            return res.status(401).json({ message: "Access denied: No user ID found" });
        }
        const deleted = await inventoryService.deleteInventoryItem(id, userId);
        if (!deleted) {
            return res.status(404).json({ message: "Inventory item not found" });
        }
        res.json({ message: "Inventory item deleted successfully" });
    }
    catch (error) {
        console.error("Delete inventory item error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

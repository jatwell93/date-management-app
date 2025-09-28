"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const product_service_1 = require("../services/product.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const productService = new product_service_1.ProductService();
// GET /products - Get all products
router.get("/", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const products = await productService.getAllProducts();
        res.json(products);
    }
    catch (_error) {
        // console.error("Get products error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /products/:id - Get a specific product by ID
router.get("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const product = await productService.getProductById(id);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(product);
    }
    catch (_error) {
        // console.error("Get product error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// GET /products/by-barcode/:barcode - Get a specific product by barcode
router.get("/by-barcode/:barcode", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const barcode = req.params.barcode;
        const product = await productService.getProductByBarcode(barcode);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(product);
    }
    catch (_error) {
        // console.error("Get product by barcode error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// POST /products - Create a new product
router.post("/", auth_middleware_1.authenticateToken, async (req, res) => {
    const { barcode, sku, name, costPrice } = req.body;
    if (!barcode || !sku || !name || costPrice === undefined) {
        return res.status(400).json({ message: "Missing required product fields" });
    }
    try {
        const newProduct = await productService.createProduct({
            barcode,
            sku,
            name,
            costPrice,
        });
        res.status(201).json(newProduct);
    }
    catch (_error) {
        // console.error("Create product error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// PUT /products/:id - Update a product
router.put("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { barcode, sku, name, costPrice } = req.body;
        // Build update object
        const updateData = {};
        if (barcode !== undefined)
            updateData.barcode = barcode;
        if (sku !== undefined)
            updateData.sku = sku;
        if (name !== undefined)
            updateData.name = name;
        if (costPrice !== undefined)
            updateData.costPrice = costPrice;
        const updatedProduct = await productService.updateProduct(id, updateData);
        if (!updatedProduct) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(updatedProduct);
    }
    catch (_error) {
        // console.error("Update product error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
// DELETE /products/:id - Delete a product
router.delete("/:id", auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await productService.deleteProduct(id);
        if (!deleted) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json({ message: "Product deleted successfully" });
    }
    catch (_error) {
        // console.error("Delete product error:", _error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.default = router;

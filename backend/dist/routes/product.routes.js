"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const product_service_1 = require("../services/product.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const validateRequest_1 = require("../middleware/validateRequest");
const schemas_1 = require("../schemas");
const data_integrity_middleware_1 = require("../middleware/data-integrity.middleware");
const multer_1 = __importDefault(require("multer"));
const rateLimiter_1 = require("../middleware/rateLimiter");
const path = __importStar(require("path"));
const router = (0, express_1.Router)();
const productService = new product_service_1.ProductService();
// Configure multer for file uploads - accept CSV, XLSX, and XLS files
const upload = (0, multer_1.default)({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        // Accept CSV, XLSX, and XLS files
        if (file.mimetype === 'text/csv' ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.endsWith('.csv') ||
            file.originalname.endsWith('.xlsx') ||
            file.originalname.endsWith('.xls')) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only CSV, XLSX, and XLS files are allowed.'));
        }
    },
});
// GET /products - Get all products for the user's organization
router.get('/', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        // TODO: Phase 7 - Update service to accept organizationId parameter
        const products = await productService.getAllProducts(); // req.organizationId!
        res.json(products);
    }
    catch (_error) {
        // console.error("Get products error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /products/:id - Get a specific product by ID
router.get('/:id', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid product id' });
        }
        const product = await productService.getProductById(id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        // Validate product belongs to user's organization
        if (product.organizationId !== req.organizationId) {
            return res
                .status(403)
                .json({ message: 'Access denied: Product belongs to different organization' });
        }
        res.json(product);
    }
    catch (_error) {
        // console.error("Get product error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /products/by-barcode/:barcode - Get a specific product by barcode
router.get('/by-barcode/:barcode', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const barcode = req.params.barcode;
        // TODO: Phase 7 - Update service to accept organizationId parameter
        const product = await productService.getProductByBarcode(barcode); // , req.organizationId!
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    }
    catch (_error) {
        // console.error("Get product by barcode error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// GET /products/by-sku/:sku - Get a specific product by SKU
router.get('/by-sku/:sku', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const sku = req.params.sku;
        // TODO: Phase 7 - Update service to accept organizationId parameter
        const product = await productService.getProductBySku(sku); // , req.organizationId!
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    }
    catch (_error) {
        // console.error("Get product by SKU error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /products - Create a new product
router.post('/', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, (0, validateRequest_1.validateRequest)(schemas_1.productSchema), validation_middleware_1.validateDataIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    const { barcode, sku, name, costPrice } = req.body;
    if (!barcode || !sku || !name || costPrice === undefined) {
        return res.status(400).json({ message: 'Missing required product fields' });
    }
    try {
        const newProduct = await productService.createProduct({
            barcode,
            sku,
            name,
            costPrice,
            organizationId: req.organizationId,
        });
        res.status(201).json(newProduct);
    }
    catch (_error) {
        // console.error("Create product error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// PUT /products/:id - Update a product
router.put('/:id', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, (0, validateRequest_1.validateRequest)(schemas_1.productSchema), validation_middleware_1.validateDataIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid product id' });
        }
        const { barcode, sku, name, costPrice } = req.body;
        // Check if product exists and belongs to user's organization
        const existingProduct = await productService.getProductById(id);
        if (!existingProduct) {
            return res.status(404).json({ message: 'Product not found' });
        }
        if (existingProduct.organizationId !== req.organizationId) {
            return res
                .status(403)
                .json({ message: 'Access denied: Product belongs to different organization' });
        }
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
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(updatedProduct);
    }
    catch (_error) {
        // console.error("Update product error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// DELETE /products/:id - Delete a product
router.delete('/:id', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid product id' });
        }
        // Check if product exists and belongs to user's organization
        const existingProduct = await productService.getProductById(id);
        if (!existingProduct) {
            return res.status(404).json({ message: 'Product not found' });
        }
        if (existingProduct.organizationId !== req.organizationId) {
            return res
                .status(403)
                .json({ message: 'Access denied: Product belongs to different organization' });
        }
        const deleted = await productService.deleteProduct(id);
        if (!deleted) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json({ message: 'Product deleted successfully' });
    }
    catch (_error) {
        // console.error("Delete product error:", _error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// POST /products/upload-csv - Upload and process a CSV, XLSX, or XLS file of products
router.post('/upload-csv', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: 'No file provided',
                details: 'Please select a CSV, XLSX, or XLS file to upload. The file should contain columns for SKU, Name, Cost, and Barcode with acceptable alternative names.',
            });
        }
        // Normalize and validate the uploaded file path to ensure it is within the upload directory
        const uploadDir = path.dirname(req.file.path);
        const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
        if (!safeFilePath.startsWith(uploadDir + path.sep)) {
            return res.status(400).json({
                message: 'Invalid file path',
                details: 'The uploaded file path is not valid.',
            });
        }
        // Process the uploaded file (passing original filename for type detection)
        // TODO: Phase 7 - Update service to accept organizationId parameter
        const result = await productService.processCSVUpload(safeFilePath, req.file.originalname); // , req.organizationId!
        // Send response with processing results and any errors
        const responseObj = {
            success: result.errors.length === 0, // Add explicit success field
            message: result.errors.length > 0
                ? `CSV processed with ${result.errors.length} error(s). See 'errors' field for details.`
                : 'CSV processed successfully',
            imported: result.imported,
            updated: result.updated,
        };
        if (result.errors.length > 0) {
            responseObj.errors = result.errors;
        }
        res.json(responseObj);
    }
    catch (error) {
        console.error('CSV upload error:', error);
        res.status(500).json({
            message: 'Internal server error during file processing',
            details: 'An unexpected error occurred while processing the CSV, XLSX, or XLS file. Please check the file format and try again.',
        });
    }
    finally {
        // Clean up the uploaded file after processing
        if (req.file) {
            const fs = require('fs');
            const uploadDir = path.dirname(req.file.path);
            const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
            if (safeFilePath.startsWith(uploadDir + path.sep)) {
                fs.unlink(safeFilePath, (err) => {
                    if (err) {
                        console.error('Error deleting uploaded file:', err);
                    }
                });
            }
            else {
                console.error('Skipping deletion of file with invalid path:', req.file.path);
            }
        }
    }
});
exports.default = router;

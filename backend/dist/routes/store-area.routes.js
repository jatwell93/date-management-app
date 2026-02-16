"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const store_area_service_1 = require("../services/store-area.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const validateRequest_1 = require("../middleware/validateRequest");
const schemas_1 = require("../schemas");
const data_integrity_middleware_1 = require("../middleware/data-integrity.middleware");
const rateLimiter_1 = require("../middleware/rateLimiter");
const router = (0, express_1.Router)();
const storeAreaService = new store_area_service_1.StoreAreaService();
// GET /store-areas - Get all store areas
router.get('/', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const areas = await storeAreaService.getAllStoreAreas();
        res.json(areas);
    }
    catch (error) {
        console.error('Get store areas error:', error);
        const errorMessage = error.message || 'Internal server error';
        res.status(500).json({ message: errorMessage });
    }
});
// GET /store-areas/:id - Get a specific store area by ID
router.get('/:id', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid store area id' });
        }
        const area = await storeAreaService.getStoreAreaById(id);
        if (!area) {
            return res.status(404).json({ message: 'Store area not found' });
        }
        res.json(area);
    }
    catch (error) {
        console.error('Get store area error:', error);
        const errorMessage = error.message || 'Internal server error';
        res.status(500).json({ message: errorMessage });
    }
});
// GET /store-areas/name/:name - Get store areas by name (can be multiple with different sub-departments)
router.get('/name/:name', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const name = req.params.name;
        const areas = await storeAreaService.getStoreAreaByName(name);
        if (!areas || areas.length === 0) {
            return res.status(404).json({ message: 'Store areas not found' });
        }
        res.json(areas);
    }
    catch (error) {
        console.error('Get store areas by name error:', error);
        const errorMessage = error.message || 'Internal server error';
        res.status(500).json({ message: errorMessage });
    }
});
// POST /store-areas - Create a new store area
router.post('/', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, (0, validateRequest_1.validateRequest)(schemas_1.storeAreaSchema), validation_middleware_1.validateDataIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    const { name, subDepartment, lastChecked } = req.body;
    if (!name) {
        return res.status(400).json({ message: 'Missing required store area fields' });
    }
    try {
        const newArea = await storeAreaService.createStoreArea({
            name,
            subDepartment,
            lastChecked,
        });
        res.status(201).json(newArea);
    }
    catch (error) {
        console.error('Create store area error:', error);
        const errorMessage = error.message || 'Internal server error';
        res.status(500).json({ message: errorMessage });
    }
});
// PUT /store-areas/:id - Update a store area
router.put('/:id', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, (0, validateRequest_1.validateRequest)(schemas_1.storeAreaSchema), validation_middleware_1.validateDataIntegrity, data_integrity_middleware_1.validateBusinessRules, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid store area id' });
        }
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
            return res.status(404).json({ message: 'Store area not found' });
        }
        res.json(updatedArea);
    }
    catch (error) {
        console.error('Update store area error:', error);
        const errorMessage = error.message || 'Internal server error';
        res.status(500).json({ message: errorMessage });
    }
});
// DELETE /store-areas/:id - Delete a store area
router.delete('/:id', auth_middleware_1.authenticateToken, rateLimiter_1.standardLimiter, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: 'Invalid store area id' });
        }
        const deleted = await storeAreaService.deleteStoreArea(id);
        if (!deleted) {
            return res.status(404).json({ message: 'Store area not found' });
        }
        res.json({ message: 'Store area deleted successfully' });
    }
    catch (error) {
        console.error('Delete store area error:', error);
        const errorMessage = error.message || 'Internal server error';
        res.status(500).json({ message: errorMessage });
    }
});
exports.default = router;

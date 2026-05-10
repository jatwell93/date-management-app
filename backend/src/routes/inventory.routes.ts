import { Router, Response, NextFunction } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { inventoryItemSchema, inventoryTransactionSchema } from '../schemas';
import {
  validateReferentialIntegrity,
  validateDataConsistency,
  validateBusinessRules,
} from '../middleware/data-integrity.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';
import { createInventoryController } from '../di/services';

const router = Router();

// GET /inventory-items - Get all inventory items
router.get('/', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const controller = createInventoryController();
  await controller.getAllInventoryItems(req, res, next);
});

// GET /inventory-items/:id - Get a specific inventory item by ID
router.get(
  '/:id',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.getInventoryItemById(req, res, next);
  },
);

// GET /inventory-items/product/:productId - Get inventory items for a specific product
router.get(
  '/product/:productId',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.getInventoryItemsByProductId(req, res, next);
  },
);

// GET /inventory-items/by-barcode/:barcode - Get inventory items for a specific product by barcode
router.get(
  '/by-barcode/:barcode',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.getInventoryItemsByBarcode(req, res, next);
  },
);

// GET /inventory-items/recent/product/:productId - Get the most recent inventory items for a specific product
router.get(
  '/recent/product/:productId',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.getRecentInventoryItemsByProductId(req, res, next);
  },
);

// GET /inventory-items/location/:locationId - Get inventory items for a specific location
router.get(
  '/location/:locationId',
  authenticateToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.getInventoryItemsByLocationId(req, res, next);
  },
);

// POST /inventory-items - Create a new inventory item
router.post(
  '/',
  authenticateToken,
  checkUsageLimit('max_inventory_items'),
  standardLimiter,
  validateRequest(inventoryItemSchema),
  validateReferentialIntegrity,
  validateDataConsistency,
  validateBusinessRules,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.createInventoryItem(req, res, next);
  },
);

// PUT /inventory-items/:id - Update an inventory item
router.put(
  '/:id',
  authenticateToken,
  standardLimiter,
  validateRequest(inventoryItemSchema),
  validateReferentialIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.updateInventoryItem(req, res, next);
  },
);

// DELETE /inventory-items/:id - Delete an inventory item
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.deleteInventoryItem(req, res, next);
  },
);

// POST /inventory-items/transaction - Log a new transaction
router.post(
  '/transaction',
  authenticateToken,
  standardLimiter,
  validateRequest(inventoryTransactionSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const controller = createInventoryController();
    await controller.logTransaction(req, res, next);
  },
);

export default router;

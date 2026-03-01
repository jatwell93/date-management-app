import { Router, Response } from 'express';
import validator from 'validator';
import { InventoryService } from '../services/inventory.service';
import { ProductService } from '../services/product.service';
import { InventoryItem } from '../models/inventory-item.model';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { inventoryItemSchema, inventoryTransactionSchema } from '../schemas';
import {
  validateReferentialIntegrity,
  validateDataConsistency,
  validateBusinessRules,
} from '../middleware/data-integrity.middleware';
import { logTransaction } from '../controllers/inventory.controller';
import { standardLimiter } from '../middleware/rateLimiter';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';

const router = Router();

// Helper function to get services with organization context
function getServicesForRequest(req: AuthRequest) {
  const inventoryService = new InventoryService(req.organizationId);
  const productService = new ProductService(undefined, req.organizationId);
  return { inventoryService, productService };
}

// GET /inventory-items - Get all inventory items
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { inventoryService } = getServicesForRequest(req);
    const items = await inventoryService.getAllInventoryItems();
    // UBS: SAFE — returning JSON (res.json) with validated data from the service; no HTML rendering.
    res.json(items);
  } catch (error) {
    console.error('Get inventory items error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /inventory-items/:id - Get a specific inventory item by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid inventory item id' });
    }
    const { inventoryService } = getServicesForRequest(req);
    const item = await inventoryService.getInventoryItemById(id);

    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    // Validate ownership: item.organization_id must match req.organizationId
    if (item.organizationId !== req.organizationId) {
      return res
        .status(403)
        .json({ message: 'Access denied: Item belongs to different organization' });
    }

    // UBS: SAFE — returning JSON (res.json) with server-side validated/authorized item; not rendering HTML
    res.json(item);
  } catch (error) {
    console.error('Get inventory item error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /inventory-items/product/:productId - Get inventory items for a specific product
router.get('/product/:productId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const productId = Number.parseInt(req.params.productId, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const { inventoryService } = getServicesForRequest(req);
    const items = await inventoryService.getInventoryItemsByProductId(productId);
    // UBS: SAFE — returning JSON array of items; input validated above (productId) and data comes from DB/service.
    res.json(items);
  } catch (error) {
    console.error('Get inventory items by product error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /inventory-items/by-barcode/:barcode - Get inventory items for a specific product by barcode
router.get('/by-barcode/:barcode', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const barcode = req.params.barcode;
    const sanitizedBarcode = barcode.replace(/-/g, '');
    if (
      !validator.isAlphanumeric(sanitizedBarcode) ||
      sanitizedBarcode.length < 8 ||
      sanitizedBarcode.length > 14
    ) {
      return res.status(400).json({ message: 'Invalid barcode format' });
    }

    // First, get the product by barcode to get its ID
    const { productService, inventoryService } = getServicesForRequest(req);
    const product = await productService.getProductByBarcode(barcode);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Then get inventory items for that product
    const items = await inventoryService.getInventoryItemsByProductId(product.id);
    // UBS: SAFE — returning JSON array of items; product lookup validated and sanitized above.
    res.json(items);
  } catch (error) {
    console.error('Get inventory items by barcode error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /inventory-items/recent/product/:productId - Get the most recent inventory items for a specific product
router.get(
  '/recent/product/:productId',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const productId = Number.parseInt(req.params.productId, 10);
      if (Number.isNaN(productId)) {
        return res.status(400).json({ message: 'Invalid product id' });
      }
      const limitParam = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isNaN(limitParam) || limitParam <= 0 ? 5 : limitParam;

      const { inventoryService } = getServicesForRequest(req);
      const items = await inventoryService.getRecentInventoryItemsByProductId(productId, limit);
      // UBS: SAFE — returning recent items as JSON; inputs were validated and limited above.
      res.json(items);
    } catch (error) {
      console.error('Get recent inventory items by product error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// GET /inventory-items/location/:locationId - Get inventory items for a specific location
router.get('/location/:locationId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const locationId = Number.parseInt(req.params.locationId, 10);
    if (Number.isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location id' });
    }
    const { inventoryService } = getServicesForRequest(req);
    const items = await inventoryService.getInventoryItemsByLocationId(locationId);
    // UBS: SAFE — locationId validated and data returned as JSON from DB/service.
    res.json(items);
  } catch (error) {
    console.error('Get inventory items by location error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

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
  async (req: AuthRequest, res: Response) => {
    const { productId, expiryDate, locationId, status } = req.body;

    // Validate required fields
    if (
      productId === undefined ||
      productId === null ||
      typeof productId !== 'number' ||
      Number.isNaN(productId) ||
      productId < 1 ||
      !expiryDate ||
      locationId === undefined ||
      locationId === null ||
      typeof locationId !== 'number' ||
      Number.isNaN(locationId) ||
      locationId < 1
    ) {
      return res.status(400).json({ message: 'Missing required inventory item fields' });
    }

    try {
      const userId = req.userId; // Get user ID from auth middleware
      if (!userId) {
        return res.status(401).json({ message: 'Access denied: No user ID found' });
      }
      const { inventoryService } = getServicesForRequest(req);
      const newInventoryItem = await inventoryService.createInventoryItem(
        {
          productId,
          expiryDate,
          locationId,
          status,
        } as Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
        userId,
      );
      // UBS: SAFE — created resource returned as JSON; inputs validated by middleware and business rules.
      res.status(201).json(newInventoryItem);
    } catch (error: any) {
      // Check if the error is about location not existing
      if (error.message === 'Location does not exist') {
        return res.status(400).json({ message: 'Location does not exist' });
      }
      console.error('Create inventory item error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
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
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid inventory item id' });
      }

      // First, get the item to validate ownership
      const { inventoryService } = getServicesForRequest(req);
      const existingItem = await inventoryService.getInventoryItemById(id);
      if (!existingItem) {
        return res.status(404).json({ message: 'Inventory item not found' });
      }

      // Validate ownership: item.organization_id must match req.organizationId
      if (existingItem.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: Item belongs to different organization' });
      }

      const { productId, expiryDate, locationId, status } = req.body;
      const userId = req.userId; // Get user ID from auth middleware
      if (!userId) {
        return res.status(401).json({ message: 'Access denied: No user ID found' });
      }

      // Build update object
      const updateData: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>> = {};
      if (productId !== undefined) updateData.productId = productId;
      if (expiryDate !== undefined) updateData.expiryDate = expiryDate;
      if (locationId !== undefined) updateData.locationId = locationId;
      if (status !== undefined) updateData.status = status;

      const updatedItem = await inventoryService.updateInventoryItem(id, updateData, userId);

      if (!updatedItem) {
        return res.status(404).json({ message: 'Inventory item not found' });
      }

      // UBS: SAFE — updated resource returned as JSON; all inputs validated and ownership enforced.
      res.json(updatedItem);
    } catch (error) {
      console.error('Update inventory item error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// DELETE /inventory-items/:id - Delete an inventory item
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid inventory item id' });
      }

      // First, get the item to validate ownership
      const { inventoryService } = getServicesForRequest(req);
      const existingItem = await inventoryService.getInventoryItemById(id);
      if (!existingItem) {
        return res.status(404).json({ message: 'Inventory item not found' });
      }

      // Validate ownership: item.organization_id must match req.organizationId
      if (existingItem.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: Item belongs to different organization' });
      }

      const userId = req.userId; // Get user ID from auth middleware
      if (!userId) {
        return res.status(401).json({ message: 'Access denied: No user ID found' });
      }
      const deleted = await inventoryService.deleteInventoryItem(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: 'Inventory item not found' });
      }

      // UBS: SAFE — confirmation message returned as JSON (no HTML injection).
      res.json({ message: 'Inventory item deleted successfully' });
    } catch (error) {
      console.error('Delete inventory item error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// POST /inventory-items/transaction - Log a new transaction
router.post(
  '/transaction',
  authenticateToken,
  standardLimiter,
  validateRequest(inventoryTransactionSchema),
  logTransaction,
);

export default router;

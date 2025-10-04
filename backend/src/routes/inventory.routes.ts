import { Router, Request, Response } from "express";
import { InventoryService } from "../services/inventory.service";
import { ProductService } from "../services/product.service";
import { InventoryItem } from "../models/inventory-item.model";
import { authenticateToken, AuthRequest } from "../middleware/auth.middleware";

const router = Router();
const inventoryService = new InventoryService();

// GET /inventory-items - Get all inventory items
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const items = await inventoryService.getAllInventoryItems();
    res.json(items);
  } catch (_error) {
    // console.error("Get inventory items error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /inventory-items/:id - Get a specific inventory item by ID
router.get("/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const item = await inventoryService.getInventoryItemById(id);

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    res.json(item);
  } catch (_error) {
    // console.error("Get inventory item error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /inventory-items/product/:productId - Get inventory items for a specific product
router.get(
  "/product/:productId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const productId = parseInt(req.params.productId);
      const items =
        await inventoryService.getInventoryItemsByProductId(productId);
      res.json(items);
    } catch (_error) {
      // console.error("Get inventory items by product error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /inventory-items/by-barcode/:barcode - Get inventory items for a specific product by barcode
router.get(
  "/by-barcode/:barcode",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const barcode = req.params.barcode;

      // First, get the product by barcode to get its ID
      const productService = new ProductService();
      const product = await productService.getProductByBarcode(barcode);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Then get inventory items for that product
      const items = await inventoryService.getInventoryItemsByProductId(product.id);
      res.json(items);
    } catch (_error) {
      // console.error("Get inventory items by barcode error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /inventory-items/recent/product/:productId - Get the most recent inventory items for a specific product
router.get(
  "/recent/product/:productId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const productId = parseInt(req.params.productId);
      const limit = parseInt(req.query.limit as string) || 5; // Default to 5 items if not specified
      
      const items = await inventoryService.getRecentInventoryItemsByProductId(productId, limit);
      res.json(items);
    } catch (_error) {
      // console.error("Get recent inventory items by product error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /inventory-items/location/:locationId - Get inventory items for a specific location
router.get(
  "/location/:locationId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const locationId = parseInt(req.params.locationId);
      const items =
        await inventoryService.getInventoryItemsByLocationId(locationId);
      res.json(items);
    } catch (_error) {
      // console.error("Get inventory items by location error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// POST /inventory-items - Create a new inventory item
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
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
    const newInventoryItem = await inventoryService.createInventoryItem({
      productId,
      expiryDate,
      locationId,
      status,
    } as Omit<InventoryItem, "id" | "createdAt" | "updatedAt">, userId);
    res.status(201).json(newInventoryItem);
  } catch (error: any) {
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
router.put("/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { productId, expiryDate, locationId, status } = req.body;
    const userId = req.userId; // Get user ID from auth middleware

    // Build update object
    const updateData: Partial<
      Omit<InventoryItem, "id" | "createdAt" | "updatedAt">
    > = {};
    if (productId !== undefined) updateData.productId = productId;
    if (expiryDate !== undefined) updateData.expiryDate = expiryDate;
    if (locationId !== undefined) updateData.locationId = locationId;
    if (status !== undefined) updateData.status = status;

    const updatedItem = await inventoryService.updateInventoryItem(
      id,
      updateData,
      userId,
    );

    if (!updatedItem) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    res.json(updatedItem);
  } catch (_error) {
    // console.error("Update inventory item error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /inventory-items/:id - Delete an inventory item
router.delete(
  "/:id",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.userId; // Get user ID from auth middleware
      const deleted = await inventoryService.deleteInventoryItem(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      res.json({ message: "Inventory item deleted successfully" });
    } catch (_error) {
      // console.error("Delete inventory item error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default router;

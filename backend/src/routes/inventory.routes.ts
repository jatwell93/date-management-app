import { Router, Request, Response } from "express";
import { InventoryService } from "../services/inventory.service";
import { InventoryItem } from "../models/inventory-item.model";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
const inventoryService = new InventoryService();

// GET /inventory-items - Get all inventory items
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const items = await inventoryService.getAllInventoryItems();
    res.json(items);
  } catch (_error) {
    // console.error("Get inventory items error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /inventory-items/:id - Get a specific inventory item by ID
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
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
  async (req: Request, res: Response) => {
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

// GET /inventory-items/location/:locationId - Get inventory items for a specific location
router.get(
  "/location/:locationId",
  authenticateToken,
  async (req: Request, res: Response) => {
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
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { productId, expiryDate, locationId, status } = req.body;
  if (!productId || !expiryDate || !locationId) {
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
    } as Omit<InventoryItem, "id" | "createdAt" | "updatedAt">);
    res.status(201).json(newInventoryItem);
  } catch (_error) {
    // console.error("Create inventory item error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /inventory-items/:id - Update an inventory item
router.put("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { productId, expiryDate, locationId, status } = req.body;

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
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await inventoryService.deleteInventoryItem(id);

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

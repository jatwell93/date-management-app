import { Router, Request, Response } from "express";
import validator from "validator";
import { InventoryService } from "../services/inventory.service";
import { ProductService } from "../services/product.service";
import { InventoryItem } from "../models/inventory-item.model";
import { authenticateToken, AuthRequest } from "../middleware/auth.middleware";
import { validateInventoryItemInput, validateInventoryTransactionInput } from "../middleware/validation.middleware";
import { validateReferentialIntegrity, validateDataConsistency, validateBusinessRules } from "../middleware/data-integrity.middleware";
import { logTransaction } from "../controllers/inventory.controller";
import { escapeHtml } from "../utils/normalize.function";

const router = Router();
const inventoryService = new InventoryService();

// GET /inventory-items - Get all inventory items
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const items = await inventoryService.getAllInventoryItems();
    res.json(escapeHtml(items));
  } catch (error) {
    console.error("Get inventory items error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /inventory-items/:id - Get a specific inventory item by ID
router.get("/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid inventory item id" });
    }
    const item = await inventoryService.getInventoryItemById(id);

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    res.json(escapeHtml(item));
  } catch (error) {
    console.error("Get inventory item error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /inventory-items/product/:productId - Get inventory items for a specific product
router.get(
  "/product/:productId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const productId = Number.parseInt(req.params.productId, 10);
      if (Number.isNaN(productId)) {
        return res.status(400).json({ message: "Invalid product id" });
      }
      const items =
        await inventoryService.getInventoryItemsByProductId(productId);
      res.json(escapeHtml(items));
    } catch (error) {
      console.error("Get inventory items by product error:", error);
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
      const sanitizedBarcode = barcode.replace(/-/g, "");
      if (
        !validator.isAlphanumeric(sanitizedBarcode) ||
        sanitizedBarcode.length < 8 ||
        sanitizedBarcode.length > 14
      ) {
        return res.status(400).json({ message: "Invalid barcode format" });
      }

      // First, get the product by barcode to get its ID
      const productService = new ProductService();
      const product = await productService.getProductByBarcode(barcode);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Then get inventory items for that product
      const items = await inventoryService.getInventoryItemsByProductId(product.id);
      res.json(escapeHtml(items));
    } catch (error) {
      console.error("Get inventory items by barcode error:", error);
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
      const productId = Number.parseInt(req.params.productId, 10);
      if (Number.isNaN(productId)) {
        return res.status(400).json({ message: "Invalid product id" });
      }
      const limitParam = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isNaN(limitParam) || limitParam <= 0 ? 5 : limitParam;
      
      const items = await inventoryService.getRecentInventoryItemsByProductId(productId, limit);
      res.json(escapeHtml(items));
    } catch (error) {
      console.error("Get recent inventory items by product error:", error);
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
      const locationId = Number.parseInt(req.params.locationId, 10);
      if (Number.isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location id" });
      }
      const items =
        await inventoryService.getInventoryItemsByLocationId(locationId);
      res.json(escapeHtml(items));
    } catch (error) {
      console.error("Get inventory items by location error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// POST /inventory-items - Create a new inventory item
router.post("/", authenticateToken, validateInventoryItemInput, validateReferentialIntegrity, validateDataConsistency, validateBusinessRules, async (req: AuthRequest, res: Response) => {
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
    } as Omit<InventoryItem, "id" | "createdAt" | "updatedAt">, userId);
    res.status(201).json(escapeHtml(newInventoryItem));
  } catch (error: any) {
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
router.put("/:id", authenticateToken, validateInventoryItemInput, validateReferentialIntegrity, validateBusinessRules, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid inventory item id" });
    }
    const { productId, expiryDate, locationId, status } = req.body;
    const userId = req.userId; // Get user ID from auth middleware
    if (!userId) {
      return res.status(401).json({ message: "Access denied: No user ID found" });
    }

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

    res.json(escapeHtml(updatedItem));
  } catch (error) {
    console.error("Update inventory item error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /inventory-items/:id - Delete an inventory item
router.delete(
  "/:id",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid inventory item id" });
      }
      const userId = req.userId; // Get user ID from auth middleware
      if (!userId) {
        return res.status(401).json({ message: "Access denied: No user ID found" });
      }
      const deleted = await inventoryService.deleteInventoryItem(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      res.json({ message: "Inventory item deleted successfully" });
    } catch (error) {
      console.error("Delete inventory item error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// POST /inventory-items/transaction - Log a new transaction
router.post("/transaction", authenticateToken, validateInventoryTransactionInput, logTransaction);

export default router;

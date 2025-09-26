import { Router, Request, Response } from "express";
import { StoreAreaService } from "../services/store-area.service";
import { StoreArea } from "../models/store-area.model";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
const storeAreaService = new StoreAreaService();

// GET /store-areas - Get all store areas
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const areas = await storeAreaService.getAllStoreAreas();
    res.json(areas);
  } catch (_error) {
    // console.error("Get store areas error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /store-areas/:id - Get a specific store area by ID
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const area = await storeAreaService.getStoreAreaById(id);

    if (!area) {
      return res.status(404).json({ message: "Store area not found" });
    }

    res.json(area);
  } catch (_error) {
    // console.error("Get store area error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /store-areas/name/:name - Get a specific store area by name
router.get(
  "/name/:name",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const name = req.params.name;
      const area = await storeAreaService.getStoreAreaByName(name);

      if (!area) {
        return res.status(404).json({ message: "Store area not found" });
      }

      res.json(area);
    } catch (_error) {
      // console.error("Get store area by name error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// POST /store-areas - Create a new store area
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { name, lastChecked } = req.body;
  if (!name) {
    return res
      .status(400)
      .json({ message: "Missing required store area fields" });
  }

  try {
    const newArea = await storeAreaService.createStoreArea({
      name,
      lastChecked,
    } as Omit<StoreArea, "id" | "createdAt" | "updatedAt">);
    res.status(201).json(newArea);
  } catch (_error) {
    // console.error("Create store area error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /store-areas/:id - Update a store area
router.put("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, lastChecked } = req.body;

    // Build update object
    const updateData: Partial<
      Omit<StoreArea, "id" | "createdAt" | "updatedAt">
    > = {};
    if (name !== undefined) updateData.name = name;
    if (lastChecked !== undefined) updateData.lastChecked = lastChecked;

    const updatedArea = await storeAreaService.updateStoreArea(id, updateData);

    if (!updatedArea) {
      return res.status(404).json({ message: "Store area not found" });
    }

    res.json(updatedArea);
  } catch (_error) {
    // console.error("Update store area error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /store-areas/:id - Delete a store area
router.delete(
  "/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storeAreaService.deleteStoreArea(id);

      if (!deleted) {
        return res.status(404).json({ message: "Store area not found" });
      }

      res.json({ message: "Store area deleted successfully" });
    } catch (_error) {
      // console.error("Delete store area error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default router;

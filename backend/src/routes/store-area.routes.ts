import { Router, Request, Response } from "express";
import { StoreAreaService } from "../services/store-area.service";
import { StoreArea } from "../models/store-area.model";
import { authenticateToken } from "../middleware/auth.middleware";
import { validateStoreAreaInput, validateDataIntegrity } from "../middleware/validation.middleware";
import { validateBusinessRules } from "../middleware/data-integrity.middleware";
import { escapeHtml } from "../utils/normalize.function";

const router = Router();
const storeAreaService = new StoreAreaService();

// GET /store-areas - Get all store areas
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const areas = await storeAreaService.getAllStoreAreas();
    res.json(escapeHtml(areas));
  } catch (error: any) {
    console.error("Get store areas error:", error);
    const errorMessage = error.message || "Internal server error";
    res.status(500).json({ message: errorMessage });
  }
});

// GET /store-areas/:id - Get a specific store area by ID
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid store area id" });
    }
    const area = await storeAreaService.getStoreAreaById(id);

    if (!area) {
      return res.status(404).json({ message: "Store area not found" });
    }

    res.json(escapeHtml(area));
  } catch (error: any) {
    console.error("Get store area error:", error);
    const errorMessage = error.message || "Internal server error";
    res.status(500).json({ message: errorMessage });
  }
});

// GET /store-areas/name/:name - Get store areas by name (can be multiple with different sub-departments)
router.get(
  "/name/:name",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const name = req.params.name;
      const areas = await storeAreaService.getStoreAreaByName(name);

      if (!areas || areas.length === 0) {
        return res.status(404).json({ message: "Store areas not found" });
      }

      res.json(escapeHtml(areas));
    } catch (error: any) {
      console.error("Get store areas by name error:", error);
      const errorMessage = error.message || "Internal server error";
      res.status(500).json({ message: errorMessage });
    }
  },
);

// POST /store-areas - Create a new store area
router.post("/", authenticateToken, validateStoreAreaInput, validateDataIntegrity, validateBusinessRules, async (req: Request, res: Response) => {
  const { name, subDepartment, lastChecked } = req.body;
  if (!name) {
    return res
      .status(400)
      .json({ message: "Missing required store area fields" });
  }

  try {
    const newArea = await storeAreaService.createStoreArea({
      name,
      subDepartment,
      lastChecked,
    } as Omit<StoreArea, "id" | "createdAt" | "updatedAt">);
    res.status(201).json(escapeHtml(newArea));
  } catch (error: any) {
    console.error("Create store area error:", error);
    const errorMessage = error.message || "Internal server error";
    res.status(500).json({ message: errorMessage });
  }
});

// PUT /store-areas/:id - Update a store area
router.put("/:id", authenticateToken, validateStoreAreaInput, validateDataIntegrity, validateBusinessRules, async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid store area id" });
    }
    const { name, subDepartment, lastChecked } = req.body;

    // Build update object
    const updateData: Partial<
      Omit<StoreArea, "id" | "createdAt" | "updatedAt">
    > = {};
    if (name !== undefined) updateData.name = name;
    if (subDepartment !== undefined) updateData.subDepartment = subDepartment;
    if (lastChecked !== undefined) updateData.lastChecked = lastChecked;

    const updatedArea = await storeAreaService.updateStoreArea(id, updateData);

    if (!updatedArea) {
      return res.status(404).json({ message: "Store area not found" });
    }

    res.json(escapeHtml(updatedArea));
  } catch (error: any) {
    console.error("Update store area error:", error);
    const errorMessage = error.message || "Internal server error";
    res.status(500).json({ message: errorMessage });
  }
});

// DELETE /store-areas/:id - Delete a store area
router.delete(
  "/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid store area id" });
      }
      const deleted = await storeAreaService.deleteStoreArea(id);

      if (!deleted) {
        return res.status(404).json({ message: "Store area not found" });
      }

      res.json(escapeHtml({ message: "Store area deleted successfully" }));
    } catch (error: any) {
      console.error("Delete store area error:", error);
      const errorMessage = error.message || "Internal server error";
      res.status(500).json({ message: errorMessage });
    }
  },
);

export default router;

import { Router, Response } from 'express';
import { StoreAreaService } from '../services/store-area.service';
import { StoreArea } from '../models/store-area.model';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { storeAreaSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import { standardLimiter } from '../middleware/rateLimiter';

const router = Router();

// Helper function to get services with organization context
function getStoreAreaServiceForRequest(req: AuthRequest) {
  return new StoreAreaService(req.organizationId);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

// GET /store-areas - Get all store areas
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const storeAreaService = getStoreAreaServiceForRequest(req);
    const areas = await storeAreaService.getAllStoreAreas();
    res.json(areas);
  } catch (error: unknown) {
    console.error('Get store areas error:', error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
});

// GET /store-areas/:id - Get a specific store area by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid store area id' });
    }
    const storeAreaService = getStoreAreaServiceForRequest(req);
    const area = await storeAreaService.getStoreAreaById(id);

    if (!area) {
      return res.status(404).json({ message: 'Store area not found' });
    }

    res.json(area);
  } catch (error: unknown) {
    console.error('Get store area error:', error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
});

// GET /store-areas/name/:name - Get store areas by name (can be multiple with different sub-departments)
router.get('/name/:name', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const name = req.params.name;
    const storeAreaService = getStoreAreaServiceForRequest(req);
    const areas = await storeAreaService.getStoreAreaByName(name);

    if (!areas || areas.length === 0) {
      return res.status(404).json({ message: 'Store areas not found' });
    }

    res.json(areas);
  } catch (error: unknown) {
    console.error('Get store areas by name error:', error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
});

// POST /store-areas - Create a new store area
router.post(
  '/',
  authenticateToken,
  standardLimiter,
  validateRequest(storeAreaSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response) => {
    const { name, subDepartment, lastChecked } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Missing required store area fields' });
    }

    try {
      const storeAreaService = getStoreAreaServiceForRequest(req);
      const newArea = await storeAreaService.createStoreArea({
        name,
        subDepartment,
        lastChecked,
      } as Omit<StoreArea, 'id' | 'createdAt' | 'updatedAt'>);
      res.status(201).json(newArea);
    } catch (error: unknown) {
      console.error('Create store area error:', error);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  },
);

// PUT /store-areas/:id - Update a store area
router.put(
  '/:id',
  authenticateToken,
  standardLimiter,
  validateRequest(storeAreaSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid store area id' });
      }
      const { name, subDepartment, lastChecked } = req.body;

      // Build update object
      const updateData: Partial<Omit<StoreArea, 'id' | 'createdAt' | 'updatedAt'>> = {};
      if (name !== undefined) updateData.name = name;
      if (subDepartment !== undefined) updateData.subDepartment = subDepartment;
      if (lastChecked !== undefined) updateData.lastChecked = lastChecked;

      const storeAreaService = getStoreAreaServiceForRequest(req);
      const updatedArea = await storeAreaService.updateStoreArea(id, updateData);

      if (!updatedArea) {
        return res.status(404).json({ message: 'Store area not found' });
      }

      res.json(updatedArea);
    } catch (error: unknown) {
      console.error('Update store area error:', error);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  },
);

// DELETE /store-areas/:id - Delete a store area
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid store area id' });
      }
      const storeAreaService = getStoreAreaServiceForRequest(req);
      const deleted = await storeAreaService.deleteStoreArea(id);

      if (!deleted) {
        return res.status(404).json({ message: 'Store area not found' });
      }

      res.json({ message: 'Store area deleted successfully' });
    } catch (error: unknown) {
      console.error('Delete store area error:', error);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  },
);

export default router;

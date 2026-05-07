import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { storeAreaSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { createStoreAreaController } from '../controllers/store-area.controller';

const router = Router();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error';
}

function routeErrorHandler(error: unknown, res: Response): void {
  res.status(500).json({ message: getErrorMessage(error) });
}

// GET /store-areas - Get all store areas
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const controller = createStoreAreaController();
  await controller.getAllStoreAreas(req, res, (error: unknown) => routeErrorHandler(error, res));
});

// GET /store-areas/:id - Get a specific store area by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  const controller = createStoreAreaController();
  await controller.getStoreAreaById(req, res, (error: unknown) => routeErrorHandler(error, res));
});

// GET /store-areas/name/:name - Get store areas by name (can be multiple with different sub-departments)
router.get('/name/:name', authenticateToken, async (req: AuthRequest, res: Response) => {
  const controller = createStoreAreaController();
  await controller.getStoreAreaByName(req, res, (error: unknown) => routeErrorHandler(error, res));
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
    const controller = createStoreAreaController();
    await controller.createStoreArea(req, res, (error: unknown) => routeErrorHandler(error, res));
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
    const controller = createStoreAreaController();
    await controller.updateStoreArea(req, res, (error: unknown) => routeErrorHandler(error, res));
  },
);

// DELETE /store-areas/:id - Delete a store area
router.delete(
  '/:id',
  authenticateToken,
  standardLimiter,
  async (req: AuthRequest, res: Response) => {
    const controller = createStoreAreaController();
    await controller.deleteStoreArea(req, res, (error: unknown) => routeErrorHandler(error, res));
  },
);

export default router;

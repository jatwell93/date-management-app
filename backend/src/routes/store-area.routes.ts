import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { bayCheckCreateSchema, checkCycleCreateSchema, storeAreaSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { createStoreAreaController } from '../controllers/store-area.controller';
import { requireOrgRole } from '../middleware/requireOrgRole';

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

// GET /store-areas/check-cycles - List store walk cycles
router.get('/check-cycles', authenticateToken, async (req: AuthRequest, res: Response) => {
  const controller = createStoreAreaController();
  await controller.listCheckCycles(req, res, (error: unknown) => routeErrorHandler(error, res));
});

// POST /store-areas/check-cycles - Start a store walk cycle
router.post(
  '/check-cycles',
  authenticateToken,
  standardLimiter,
  requireOrgRole('admin', 'manager'),
  validateRequest(checkCycleCreateSchema),
  async (req: AuthRequest, res: Response) => {
    const controller = createStoreAreaController();
    await controller.createCheckCycle(req, res, (error: unknown) => routeErrorHandler(error, res));
  },
);

// POST /store-areas/check-cycles/:id/complete - Complete an active store walk cycle
router.post(
  '/check-cycles/:id/complete',
  authenticateToken,
  standardLimiter,
  requireOrgRole('admin', 'manager'),
  async (req: AuthRequest, res: Response) => {
    const controller = createStoreAreaController();
    await controller.completeCheckCycle(req, res, (error: unknown) =>
      routeErrorHandler(error, res),
    );
  },
);

// POST /store-areas/bay-checks - Record a bay check in the active cycle
router.post(
  '/bay-checks',
  authenticateToken,
  standardLimiter,
  requireOrgRole('admin', 'manager'),
  validateRequest(bayCheckCreateSchema),
  async (req: AuthRequest, res: Response) => {
    const controller = createStoreAreaController();
    await controller.recordBayCheck(req, res, (error: unknown) => routeErrorHandler(error, res));
  },
);

// GET /store-areas/floor-progress - Read active walk coverage grouped by department
router.get('/floor-progress', authenticateToken, async (req: AuthRequest, res: Response) => {
  const controller = createStoreAreaController();
  await controller.getFloorProgress(req, res, (error: unknown) => routeErrorHandler(error, res));
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

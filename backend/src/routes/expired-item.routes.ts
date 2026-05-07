import { Router, Response } from 'express';
import { createExpiredItemController } from '../controllers/expired-item.controller';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { expiredItemProcessSchema } from '../schemas';
import { standardLimiter } from '../middleware/rateLimiter';

const router = Router();
const expiredItemController = createExpiredItemController();

function routeErrorHandler(_error: unknown, res: Response): void {
  res.status(500).json({ message: 'Internal server error' });
}

// GET /expired-items - Get all expired items
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  await expiredItemController.getAllExpiredItems(req, res, (error) =>
    routeErrorHandler(error, res),
  );
});

// POST /expired-items/process - Process an expired item (mark as sold through or expired)
router.post(
  '/process',
  authenticateToken,
  standardLimiter,
  validateRequest(expiredItemProcessSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    await expiredItemController.processExpiredItem(req, res, (error) =>
      routeErrorHandler(error, res),
    );
  },
);

// GET /reports/expired-losses - Get financial loss reports by SKU and store area
router.get(
  '/reports/expired-losses',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    await expiredItemController.getExpiredLossReports(req, res, (error) =>
      routeErrorHandler(error, res),
    );
  },
);

export default router;

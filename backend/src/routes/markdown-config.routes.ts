import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireManager } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { markdownConfigSchema } from '../schemas';
import { standardLimiter } from '../middleware/rateLimiter';
import { createMarkdownConfigController } from '../controllers/markdown-config.controller';

const router = Router();

// GET /markdown-config - the org's markdown matrix + whether retail basis is available.
// Readable by any authenticated user so calculators and reports can price stock.
router.get('/', authenticateToken, async (req: AuthRequest, res: Response, next) => {
  const controller = createMarkdownConfigController();
  await controller.getConfig(req, res, next);
});

// PUT /markdown-config - update the matrix. Manager/admin only.
router.put(
  '/',
  authenticateToken,
  requireManager,
  standardLimiter,
  validateRequest(markdownConfigSchema),
  async (req: AuthRequest, res: Response, next) => {
    const controller = createMarkdownConfigController();
    await controller.updateConfig(req, res, next);
  },
);

export default router;

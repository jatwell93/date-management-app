import { Router, Response } from 'express';
import { AuthRequest, requireManager } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { standardLimiter } from '../middleware/rateLimiter';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  assignSupplierSchema,
} from '../schemas';
import { createSupplierCreditController } from '../controllers/supplier-credit.controller';

// Authentication is applied once at the app-level mount in index.ts, matching the
// other feature routers (see markdown-config.routes.ts).
const router = Router();

// GET /supplier-credits/suppliers — list suppliers (any authenticated user; the
// claim builder and triage board need to read them).
router.get('/suppliers', async (req: AuthRequest, res: Response, next) => {
  await createSupplierCreditController().listSuppliers(req, res, next);
});

// POST /supplier-credits/suppliers — create a supplier + policy. Manager/admin only.
router.post(
  '/suppliers',
  requireManager,
  standardLimiter,
  validateRequest(supplierCreateSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().createSupplier(req, res, next);
  },
);

// PUT /supplier-credits/suppliers/:id — update a supplier + policy. Manager/admin only.
router.put(
  '/suppliers/:id',
  requireManager,
  standardLimiter,
  validateRequest(supplierUpdateSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().updateSupplier(req, res, next);
  },
);

// PUT /supplier-credits/products/:productId/supplier — assign (or clear) a product's
// supplier. This is the self-building map: any authenticated user triaging the pool
// can attach a SKU to its supplier.
router.put(
  '/products/:productId/supplier',
  standardLimiter,
  validateRequest(assignSupplierSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().assignProductSupplier(req, res, next);
  },
);

// GET /supplier-credits/claimable-pool — expired write-offs grouped by supplier.
router.get('/claimable-pool', async (req: AuthRequest, res: Response, next) => {
  await createSupplierCreditController().getClaimablePool(req, res, next);
});

export default router;

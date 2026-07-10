import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest, requireManager } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { standardLimiter } from '../middleware/rateLimiter';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  assignSupplierSchema,
  claimCreateSchema,
  claimOutcomeSchema,
} from '../schemas';
import { createSupplierCreditController } from '../controllers/supplier-credit.controller';
import { createCreditClaimController } from '../controllers/credit-claim.controller';

// Authentication is applied once at the app-level mount in index.ts, matching the
// other feature routers (see markdown-config.routes.ts).
const router = Router();

// Claim photos are small images uploaded directly (memory storage, 10MB cap),
// matching the direct-upload path in upload.routes.ts.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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

// ── Claims ────────────────────────────────────────────────────────────────────

// GET /supplier-credits/recovery-report — outstanding, recovery rate, unclaimed value.
router.get('/recovery-report', async (req: AuthRequest, res: Response, next) => {
  await createCreditClaimController().getRecoveryReport(req, res, next);
});

// GET /supplier-credits/claims?view=open|settled — triage lists.
router.get('/claims', async (req: AuthRequest, res: Response, next) => {
  await createCreditClaimController().listClaims(req, res, next);
});

// POST /supplier-credits/claims — build a draft claim from write-offs.
router.post(
  '/claims',
  standardLimiter,
  validateRequest(claimCreateSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createCreditClaimController().buildClaim(req, res, next);
  },
);

// GET /supplier-credits/claims/:id — claim detail (lines, photos, timeline).
router.get('/claims/:id', async (req: AuthRequest, res: Response, next) => {
  await createCreditClaimController().getClaim(req, res, next);
});

// POST /supplier-credits/claims/:id/lines/:lineId/photos — attach a photo to a line.
router.post(
  '/claims/:id/lines/:lineId/photos',
  standardLimiter,
  photoUpload.single('file'),
  async (req: AuthRequest, res: Response, next) => {
    await createCreditClaimController().addPhoto(req, res, next);
  },
);

// POST /supplier-credits/claims/:id/send — send the claim to the supplier.
router.post('/claims/:id/send', standardLimiter, async (req: AuthRequest, res: Response, next) => {
  await createCreditClaimController().sendClaim(req, res, next);
});

// POST /supplier-credits/claims/:id/follow-up — send a follow-up nudge.
router.post(
  '/claims/:id/follow-up',
  standardLimiter,
  async (req: AuthRequest, res: Response, next) => {
    await createCreditClaimController().sendFollowUp(req, res, next);
  },
);

// POST /supplier-credits/claims/:id/outcome — record credited/partial/rejected.
router.post(
  '/claims/:id/outcome',
  standardLimiter,
  validateRequest(claimOutcomeSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createCreditClaimController().recordOutcome(req, res, next);
  },
);

export default router;

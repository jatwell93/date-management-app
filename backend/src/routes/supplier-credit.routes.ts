import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth.middleware';
import { ValidationError } from '../errors';
import { validateRequest } from '../middleware/validateRequest';
import { standardLimiter } from '../middleware/rateLimiter';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  supplierPatchSchema,
  bulkAttachPolicySchema,
  bulkLinkProductsSchema,
  assignSupplierSchema,
  brandCreateSchema,
  brandSupplierSchema,
  correctionReviewSchema,
  claimCreateSchema,
  claimOutcomeSchema,
  idParamSchema,
} from '../schemas';
import { createSupplierCreditController } from '../controllers/supplier-credit.controller';
import { createCreditClaimController } from '../controllers/credit-claim.controller';

// Authentication is applied once at the app-level mount in index.ts, matching the
// other feature routers (see markdown-config.routes.ts).
const router = Router();
export const platformCatalogueCorrectionRouter = Router();

// Claim photos are phone snaps of expired stock uploaded directly (memory storage,
// 10MB cap), matching the direct-upload path in upload.routes.ts. Restricted to image
// types so the claim email never carries an arbitrary attachment to the supplier.
const ALLOWED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Unsupported photo type: ${file.mimetype}. Upload an image.`));
    }
  },
});

// GET /supplier-credits/suppliers — list suppliers (any authenticated user; the
// claim builder and triage board need to read them).
router.get('/suppliers', async (req: AuthRequest, res: Response, next) => {
  await createSupplierCreditController().listSuppliers(req, res, next);
});

// POST /supplier-credits/suppliers — any authenticated user may create a bare supplier;
// effective policy fields are admin-gated transactionally in the service.
router.post(
  '/suppliers',
  standardLimiter,
  validateRequest(supplierCreateSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().createSupplier(req, res, next);
  },
);

// PUT /supplier-credits/suppliers/:id — full replacement; the service permits ordinary
// fields for any authenticated user and admin-gates effective policy changes.
router.put(
  '/suppliers/:id',
  standardLimiter,
  validateRequest(supplierUpdateSchema),
  validateRequest(idParamSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().updateSupplier(req, res, next);
  },
);

router.patch(
  '/suppliers/:id',
  standardLimiter,
  validateRequest(supplierPatchSchema),
  validateRequest(idParamSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().patchSupplier(req, res, next);
  },
);

router.delete(
  '/suppliers/:id/policy',
  standardLimiter,
  validateRequest(idParamSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().clearSupplierPolicy(req, res, next);
  },
);

router.get('/policy-review', async (req: AuthRequest, res: Response, next) => {
  await createSupplierCreditController().listPolicyReview(req, res, next);
});

router.post(
  '/policy-review/bulk-attach',
  standardLimiter,
  validateRequest(bulkAttachPolicySchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().bulkAttachPolicy(req, res, next);
  },
);

router.post(
  '/brands/bulk-link',
  standardLimiter,
  validateRequest(bulkLinkProductsSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().bulkLinkProducts(req, res, next);
  },
);

router.get('/brands', async (req: AuthRequest, res: Response, next) => {
  await createSupplierCreditController().listBrands(req, res, next);
});

router.get('/brand-review', async (req: AuthRequest, res: Response, next) => {
  await createSupplierCreditController().reviewBrands(req, res, next);
});

router.post(
  '/brands',
  standardLimiter,
  validateRequest(brandCreateSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().addBrand(req, res, next);
  },
);

router.put(
  '/brands/:id/supplier',
  standardLimiter,
  validateRequest(brandSupplierSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().confirmBrandSupplier(req, res, next);
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

router.post(
  '/claimable-pool/:transactionId/dispose',
  standardLimiter,
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().disposeWriteOff(req, res, next);
  },
);

platformCatalogueCorrectionRouter.get(
  '/catalogue-corrections',
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().listCatalogueCorrections(req, res, next);
  },
);

platformCatalogueCorrectionRouter.get(
  '/catalogue/provenance',
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().getCatalogueProvenance(req, res, next);
  },
);

platformCatalogueCorrectionRouter.patch(
  '/catalogue-corrections/:id',
  standardLimiter,
  validateRequest(correctionReviewSchema),
  async (req: AuthRequest, res: Response, next) => {
    await createSupplierCreditController().reviewCatalogueCorrection(req, res, next);
  },
);

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

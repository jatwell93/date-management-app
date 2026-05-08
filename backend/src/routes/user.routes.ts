import { Router, Response, NextFunction } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/requireOrgRole';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { userSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';
import { createUserController } from '../controllers/user.controller';

const router = Router();
const userController = createUserController();

// GET /users - Get all users (Manager only)
router.get(
  '/',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  (req: AuthRequest, res: Response, next: NextFunction) => userController.getUsers(req, res, next),
);

// GET /users/:id - Get a specific user by ID (Manager only)
router.get(
  '/:id',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  (req: AuthRequest, res: Response, next: NextFunction) =>
    userController.getUserById(req, res, next),
);

// POST /users - Create a new user (Manager only)
router.post(
  '/',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  checkUsageLimit('max_users'),
  standardLimiter,
  validateRequest(userSchema),
  validateDataIntegrity,
  validateBusinessRules,
  (req: AuthRequest, res: Response, next: NextFunction) =>
    userController.createUser(req, res, next),
);

// PUT /users/:id - Update a user (Manager only)
router.put(
  '/:id',
  authenticateToken,
  requireOrgRole('admin', 'manager'),
  standardLimiter,
  validateRequest(userSchema),
  validateDataIntegrity,
  validateBusinessRules,
  (req: AuthRequest, res: Response, next: NextFunction) =>
    userController.updateUser(req, res, next),
);

// DELETE /users/:id - Delete a user (Manager only)
router.delete(
  '/:id',
  authenticateToken,
  requireOrgRole('admin'),
  standardLimiter,
  (req: AuthRequest, res: Response, next: NextFunction) =>
    userController.deleteUser(req, res, next),
);

export default router;

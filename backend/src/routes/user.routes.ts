import { Router, Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { User } from '../models/user.model';
import { authenticateToken, requireManager, AuthRequest } from '../middleware/auth.middleware';
import { validateDataIntegrity } from '../middleware/validation.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { userSchema } from '../schemas';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import { standardLimiter } from '../middleware/rateLimiter';
import { checkUsageLimit } from '../middleware/feature-gate.middleware';

const router = Router();

// Helper function to get services with organization context
function getUserServiceForRequest(req: AuthRequest) {
  return new UserService(req.organizationId);
}

// GET /users - Get all users (Manager only)
router.get(
  '/',
  authenticateToken,
  requireManager,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userService = getUserServiceForRequest(req);
      const users = await userService.getUsers();
      res.json(users);
    } catch (error) {
      next(error);
    }
  },
);

// GET /users/:id - Get a specific user by ID (Manager only)
router.get(
  '/:id',
  authenticateToken,
  requireManager,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid user id' });
      }
      const userService = getUserServiceForRequest(req);
      const user = await userService.getUserById(id);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Validate ownership: user.organization_id must match req.organizationId
      if (user.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: User belongs to different organization' });
      }

      res.json(user);
    } catch (error) {
      next(error);
    }
  },
);

// POST /users - Create a new user (Manager only)
router.post(
  '/',
  authenticateToken,
  requireManager,
  checkUsageLimit('max_users'),
  standardLimiter,
  validateRequest(userSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { pin, role } = req.body;

      if (!pin || !role) {
        return res.status(400).json({ message: 'PIN and role are required' });
      }

      // Validate organization context
      if (!req.organizationId) {
        return res.status(401).json({ message: 'Access denied: No organization context found' });
      }

      // FIX: Use Omit to create a type that represents a user *before* it's saved to the DB.
      const newUser: Omit<User, 'id' | 'created_at' | 'updated_at'> = {
        pin,
        role,
        organizationId: req.organizationId, // Use req.organizationId from auth context
      };

      const userService = getUserServiceForRequest(req);
      const createdUser = await userService.createUser(newUser);
      res.status(201).json(createdUser);
    } catch (error) {
      next(error);
    }
  },
);

// PUT /users/:id - Update a user (Manager only)
router.put(
  '/:id',
  authenticateToken,
  requireManager,
  standardLimiter,
  validateRequest(userSchema),
  validateDataIntegrity,
  validateBusinessRules,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid user id' });
      }

      // First, get the user to validate ownership
      const userService = getUserServiceForRequest(req);
      const existingUser = await userService.getUserById(id);
      if (!existingUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Validate ownership: user.organization_id must match req.organizationId
      if (existingUser.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: User belongs to different organization' });
      }

      const { pin, role } = req.body;

      const user: Partial<User> = {};
      if (pin !== undefined) user.pin = pin;
      if (role !== undefined) user.role = role;

      const updated = await userService.updateUser(id, user);

      if (!updated) {
        return res.status(404).json({ message: 'User not found' });
      }

      const updatedUser = await userService.getUserById(id);
      res.json(updatedUser);
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /users/:id - Delete a user (Manager only)
router.delete(
  '/:id',
  authenticateToken,
  requireManager,
  standardLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid user id' });
      }

      // First, get the user to validate ownership
      const userService = getUserServiceForRequest(req);
      const existingUser = await userService.getUserById(id);
      if (!existingUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Validate ownership: user.organization_id must match req.organizationId
      if (existingUser.organizationId !== req.organizationId) {
        return res
          .status(403)
          .json({ message: 'Access denied: User belongs to different organization' });
      }

      const deleted = await userService.deleteUser(id);

      if (!deleted) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

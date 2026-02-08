import { Router, Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { User } from '../models/user.model';
import { authenticateToken, requireManager } from '../middleware/auth.middleware';
import { validateUserInput, validateDataIntegrity } from '../middleware/validation.middleware';
import { validateBusinessRules } from '../middleware/data-integrity.middleware';
import { escapeHtml } from '../utils/normalize.function';

const router = Router();
const userService = new UserService();

// GET /users - Get all users (Manager only)
router.get('/', authenticateToken, requireManager, async (req: Request, res: Response) => {
  try {
    const users = await userService.getUsers();
    res.json(escapeHtml(users));
  } catch (_error) {
    // console.error("Error getting users:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /users/:id - Get a specific user by ID (Manager only)
router.get('/:id', authenticateToken, requireManager, async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const user = await userService.getUserById(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(escapeHtml(user));
  } catch (_error) {
    // console.error("Error getting user:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /users - Create a new user (Manager only)
router.post(
  '/',
  authenticateToken,
  requireManager,
  validateUserInput,
  validateDataIntegrity,
  validateBusinessRules,
  async (req: Request, res: Response) => {
    try {
      const { pin, role } = req.body;

      if (!pin || !role) {
        return res.status(400).json({ message: 'PIN and role are required' });
      }

      // FIX: Use Omit to create a type that represents a user *before* it's saved to the DB.
      const newUser: Omit<User, 'id' | 'created_at' | 'updated_at'> = {
        pin,
        role,
      };

      const createdUser = await userService.createUser(newUser);
      res.status(201).json(escapeHtml(createdUser));
    } catch (_error) {
      // console.error("Error creating user:", _error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// PUT /users/:id - Update a user (Manager only)
router.put(
  '/:id',
  authenticateToken,
  requireManager,
  validateUserInput,
  validateDataIntegrity,
  validateBusinessRules,
  async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'Invalid user id' });
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
      res.json(escapeHtml(updatedUser));
    } catch (_error) {
      // console.error("Error updating user:", _error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

// DELETE /users/:id - Delete a user (Manager only)
router.delete('/:id', authenticateToken, requireManager, async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const deleted = await userService.deleteUser(id);

    if (!deleted) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(escapeHtml({ message: 'User deleted successfully' }));
  } catch (_error) {
    // console.error("Error deleting user:", _error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;

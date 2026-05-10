import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/user.model';
import { UserService } from '../services/user.service';

type CreateUserPayload = Omit<User, 'id' | 'created_at' | 'updated_at'>;

export class UserController {
  constructor(private userServiceFactory: (organizationId?: string) => UserService) {}

  private getService(req: AuthRequest): UserService {
    return this.userServiceFactory(req.organizationId);
  }

  private parseUserId(req: AuthRequest, res: Response): number | undefined {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'Invalid user id' });
      return undefined;
    }
    return id;
  }

  private validateUserOwnership(user: User, req: AuthRequest, res: Response): boolean {
    if (user.organizationId === req.organizationId) {
      return true;
    }

    res.status(403).json({ message: 'Access denied: User belongs to different organization' });
    return false;
  }

  async getUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await this.getService(req).getUsers();
      res.json(users);
    } catch (error) {
      next(error);
    }
  }

  async getUserById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseUserId(req, res);
      if (id === undefined) return;

      const user = await this.getService(req).getUserById(id);
      if (!user) {
        res.status(404).json({ message: 'User not found' });
        return;
      }

      if (!this.validateUserOwnership(user, req, res)) return;

      res.json(user);
    } catch (error) {
      next(error);
    }
  }

  async createUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pin, role } = req.body;

      if (!pin || !role) {
        res.status(400).json({ message: 'PIN and role are required' });
        return;
      }

      if (!req.organizationId) {
        res.status(401).json({ message: 'Access denied: No organization context found' });
        return;
      }

      const newUser: CreateUserPayload = {
        pin,
        role,
        organizationId: req.organizationId,
      };

      const createdUser = await this.getService(req).createUser(newUser);
      res.status(201).json(createdUser);
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseUserId(req, res);
      if (id === undefined) return;

      const userService = this.getService(req);
      const existingUser = await userService.getUserById(id);
      if (!existingUser) {
        res.status(404).json({ message: 'User not found' });
        return;
      }

      if (!this.validateUserOwnership(existingUser, req, res)) return;

      const { pin, role } = req.body;
      const user: Partial<User> = {};
      if (pin !== undefined) user.pin = pin;
      if (role !== undefined) user.role = role;

      const updated = await userService.updateUser(id, user);
      if (!updated) {
        res.status(404).json({ message: 'User not found' });
        return;
      }

      const updatedUser = await userService.getUserById(id);
      res.json(updatedUser);
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseUserId(req, res);
      if (id === undefined) return;

      const userService = this.getService(req);
      const existingUser = await userService.getUserById(id);
      if (!existingUser) {
        res.status(404).json({ message: 'User not found' });
        return;
      }

      if (!this.validateUserOwnership(existingUser, req, res)) return;

      const deleted = await userService.deleteUser(id);
      if (!deleted) {
        res.status(404).json({ message: 'User not found' });
        return;
      }

      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export function createUserController(): UserController {
  return new UserController((organizationId?: string) => new UserService(organizationId));
}

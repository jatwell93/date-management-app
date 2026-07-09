import { Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { StoreArea } from '../models/store-area.model';
import { StoreAreaService } from '../services/store-area.service';

type StoreAreaPayload = Omit<StoreArea, 'id' | 'createdAt' | 'updatedAt'>;

@injectable()
export class StoreAreaController {
  constructor(
    @inject('StoreAreaServiceFactory')
    private storeAreaServiceFactory: (orgId?: string) => StoreAreaService,
  ) {}

  private getService(req: AuthRequest): StoreAreaService {
    return this.storeAreaServiceFactory(req.organizationId);
  }

  private parseStoreAreaId(req: AuthRequest, res: Response): number | undefined {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'Invalid store area id' });
      return undefined;
    }
    return id;
  }

  private handleError(error: unknown, next: NextFunction): void {
    next(error);
  }

  private handleStoreWalkError(error: unknown, res: Response, next: NextFunction): void {
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (message.includes('Active check cycle already exists')) {
      res.status(409).json({ message });
      return;
    }
    if (message.includes('Active check cycle is required')) {
      res.status(409).json({ message });
      return;
    }
    if (message.includes('leaf bay')) {
      res.status(400).json({ message });
      return;
    }
    if (message.includes('not found')) {
      res.status(404).json({ message });
      return;
    }

    this.handleError(error, next);
  }

  async getAllStoreAreas(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const areas = await this.getService(req).getAllStoreAreas();
      res.json(areas);
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async getStoreAreaById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseStoreAreaId(req, res);
      if (id === undefined) return;

      const area = await this.getService(req).getStoreAreaById(id);
      if (!area) {
        res.status(404).json({ message: 'Store area not found' });
        return;
      }

      res.json(area);
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async getStoreAreaByName(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const areas = await this.getService(req).getStoreAreaByName(req.params.name);
      if (!areas || areas.length === 0) {
        res.status(404).json({ message: 'Store areas not found' });
        return;
      }

      res.json(areas);
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async createStoreArea(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const { name, subDepartment, lastChecked } = req.body;
    if (!name) {
      res.status(400).json({ message: 'Missing required store area fields' });
      return;
    }

    try {
      const newArea = await this.getService(req).createStoreArea({
        name,
        subDepartment,
        lastChecked,
      } as StoreAreaPayload);
      res.status(201).json(newArea);
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async updateStoreArea(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseStoreAreaId(req, res);
      if (id === undefined) return;

      const { name, subDepartment, lastChecked } = req.body;
      const updateData: Partial<StoreAreaPayload> = {};
      if (name !== undefined) updateData.name = name;
      if (subDepartment !== undefined) updateData.subDepartment = subDepartment;
      if (lastChecked !== undefined) updateData.lastChecked = lastChecked;

      const updatedArea = await this.getService(req).updateStoreArea(id, updateData);
      if (!updatedArea) {
        res.status(404).json({ message: 'Store area not found' });
        return;
      }

      res.json(updatedArea);
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async deleteStoreArea(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseStoreAreaId(req, res);
      if (id === undefined) return;

      const deleted = await this.getService(req).deleteStoreArea(id);
      if (!deleted) {
        res.status(404).json({ message: 'Store area not found' });
        return;
      }

      res.json({ message: 'Store area deleted successfully' });
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async listCheckCycles(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cycles = await this.getService(req).listCheckCycles();
      res.json(cycles);
    } catch (error) {
      this.handleError(error, next);
    }
  }

  async createCheckCycle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, startedAt } = req.body;
      const cycle = await this.getService(req).createCheckCycle({
        name: String(name).trim(),
        startedAt,
      });
      res.status(201).json(cycle);
    } catch (error) {
      this.handleStoreWalkError(error, res, next);
    }
  }

  async completeCheckCycle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.parseStoreAreaId(req, res);
      if (id === undefined) return;

      const cycle = await this.getService(req).completeCheckCycle(id);
      res.json(cycle);
    } catch (error) {
      this.handleStoreWalkError(error, res, next);
    }
  }

  async recordBayCheck(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = Number(req.userId ?? req.user?.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(401).json({ message: 'Access denied: No user context found' });
        return;
      }

      const storeAreaId = req.body.storeAreaId ?? req.body.store_area_id;
      const checkedAt = req.body.checkedAt ?? req.body.checked_at;
      const itemsAddedCount = req.body.itemsAddedCount ?? req.body.items_added_count;
      const check = await this.getService(req).recordBayCheck(userId, {
        storeAreaId: Number(storeAreaId),
        checkedAt,
        itemsAddedCount,
        notes: req.body.notes,
      });
      res.status(201).json(check);
    } catch (error) {
      this.handleStoreWalkError(error, res, next);
    }
  }

  async getFloorProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const progress = await this.getService(req).getFloorProgress();
      res.json(progress);
    } catch (error) {
      this.handleError(error, next);
    }
  }
}

export function createStoreAreaController(): StoreAreaController {
  return new StoreAreaController((organizationId?: string) => new StoreAreaService(organizationId));
}

import { Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { ExpiredItemService } from '../services/expired-item.service';

type ExpiredItemAction = 'sold_through' | 'expired';
type ExpiredItemServiceFactory = (organizationId?: string) => ExpiredItemService;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isProcessValidationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith('Cannot discard') ||
      error.message === 'Units discarded must be a positive number when marking as expired')
  );
}

@injectable()
export class ExpiredItemController {
  constructor(
    @inject('ExpiredItemServiceFactory')
    private expiredItemServiceFactory: ExpiredItemServiceFactory,
  ) {}

  private getService(req: AuthRequest): ExpiredItemService {
    return this.expiredItemServiceFactory(req.organizationId);
  }

  private parseInventoryItemId(req: AuthRequest, res: Response): number | undefined {
    const { inventoryItemId } = req.body as { inventoryItemId?: unknown };
    if (!isPositiveInteger(inventoryItemId)) {
      res.status(400).json({ message: 'Missing or invalid required field: inventoryItemId' });
      return undefined;
    }

    return inventoryItemId;
  }

  private parseAction(req: AuthRequest, res: Response): ExpiredItemAction | undefined {
    const { action } = req.body as { action?: unknown };
    if (action !== 'sold_through' && action !== 'expired') {
      res.status(400).json({ message: "Action must be either 'sold_through' or 'expired'" });
      return undefined;
    }

    return action;
  }

  private parseUnitsDiscarded(
    req: AuthRequest,
    res: Response,
    action: ExpiredItemAction,
  ): number | undefined {
    const { unitsDiscarded } = req.body as { unitsDiscarded?: unknown };
    if (action !== 'expired') {
      return undefined;
    }

    if (!isPositiveInteger(unitsDiscarded)) {
      res
        .status(400)
        .json({ message: 'Units discarded must be a positive number when marking as expired' });
      return undefined;
    }

    return unitsDiscarded;
  }

  async getAllExpiredItems(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await this.getService(req).getAllExpiredItems();
      res.json(items);
    } catch (error) {
      next(error);
    }
  }

  async processExpiredItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const inventoryItemId = this.parseInventoryItemId(req, res);
    if (inventoryItemId === undefined) return;

    const action = this.parseAction(req, res);
    if (!action) return;

    const unitsDiscarded = this.parseUnitsDiscarded(req, res, action);
    if (action === 'expired' && unitsDiscarded === undefined) return;

    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ message: 'Access denied: No user ID found' });
      return;
    }

    try {
      const transaction = await this.getService(req).processExpiredItem(
        inventoryItemId,
        userId,
        action,
        unitsDiscarded,
      );
      res.status(201).json(transaction);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ message: error.message });
        return;
      }
      if (isProcessValidationError(error)) {
        res.status(400).json({ message: error.message });
        return;
      }

      next(error);
    }
  }

  async getExpiredLossReports(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = this.getService(req);
      const lossesBySKU = await service.getFinancialLossesBySKU();
      const lossesByStoreArea = await service.getFinancialLossesByStoreArea();

      res.json({
        lossesBySKU,
        lossesByStoreArea,
      });
    } catch (error) {
      next(error);
    }
  }
}

export function createExpiredItemController(): ExpiredItemController {
  return new ExpiredItemController(() => new ExpiredItemService());
}

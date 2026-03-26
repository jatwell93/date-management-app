import { Response } from 'express';
import { InventoryService } from '../services/inventory.service';
import { Logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth.middleware';

export const logTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.organizationId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization context required',
      });
      return;
    }

    const transaction = req.body;
    const inventoryService = new InventoryService(req.organizationId);
    const newTransactionId = await inventoryService.logTransaction(transaction);

    res.status(201).json({
      message: 'Transaction logged successfully',
      transactionId: newTransactionId,
    });
  } catch (error) {
    Logger.error('Error logging transaction', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Failed to log transaction',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};

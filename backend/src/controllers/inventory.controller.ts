
import { Request, Response } from 'express';
import { InventoryService } from '../services/inventory.service';
import { Logger } from '../utils/logger';

const inventoryService = new InventoryService();

export const logTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const transaction = req.body;
    const newTransactionId = await inventoryService.logTransaction(transaction);

    res.status(201).json({
      message: 'Transaction logged successfully',
      transactionId: newTransactionId,
    });
  } catch (error) {
    Logger.error('Error logging transaction', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    res.status(500).json({
      error: 'Failed to log transaction',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
};

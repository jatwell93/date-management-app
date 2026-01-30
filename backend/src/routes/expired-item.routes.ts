import { Router, Response } from 'express';
import { ExpiredItemService } from '../services/expired-item.service';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const expiredItemService = new ExpiredItemService();

// GET /expired-items - Get all expired items
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const items = await expiredItemService.getAllExpiredItems();
    res.json(items);
  } catch (error) {
    console.error('Get expired items error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /expired-items/process - Process an expired item (mark as sold through or expired)
router.post('/process', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { inventoryItemId, action, unitsDiscarded } = req.body;

  // Validate required fields
  if (
    inventoryItemId === undefined ||
    inventoryItemId === null ||
    typeof inventoryItemId !== 'number' ||
    Number.isNaN(inventoryItemId) ||
    inventoryItemId < 1
  ) {
    return res.status(400).json({ message: 'Missing or invalid required field: inventoryItemId' });
  }

  if (!action || (action !== 'sold_through' && action !== 'expired')) {
    return res.status(400).json({ message: "Action must be either 'sold_through' or 'expired'" });
  }

  // Validate unitsDiscarded if action is 'expired'
  if (action === 'expired') {
    if (
      unitsDiscarded === undefined ||
      unitsDiscarded === null ||
      typeof unitsDiscarded !== 'number' ||
      Number.isNaN(unitsDiscarded) ||
      unitsDiscarded <= 0
    ) {
      return res
        .status(400)
        .json({ message: 'Units discarded must be a positive number when marking as expired' });
    }
  }

  try {
    const userId = req.userId; // Get user ID from auth middleware
    if (!userId) {
      return res.status(401).json({ message: 'Access denied: No user ID found' });
    }

    const transaction = await expiredItemService.processExpiredItem(
      inventoryItemId,
      userId,
      action,
      unitsDiscarded,
    );

    res.status(201).json(transaction);
  } catch (error: any) {
    console.error('Process expired item error:', error);

    // Handle specific error cases
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }

    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /reports/expired-losses - Get financial loss reports by SKU and store area
router.get(
  '/reports/expired-losses',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      // Get both reports
      const lossesBySKU = await expiredItemService.getFinancialLossesBySKU();
      const lossesByStoreArea = await expiredItemService.getFinancialLossesByStoreArea();

      res.json({
        lossesBySKU,
        lossesByStoreArea,
      });
    } catch (error) {
      console.error('Get expired losses report error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },
);

export default router;

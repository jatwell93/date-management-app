import express from 'express';
import request from 'supertest';

const mockGetAllExpiredItems = vi.fn();
const mockProcessExpiredItem = vi.fn();
const mockGetFinancialLossesBySKU = vi.fn();
const mockGetFinancialLossesByStoreArea = vi.fn();

const mockExpiredItemServiceCtor = vi.fn().mockImplementation(function () {
  return {
    getAllExpiredItems: (...args: unknown[]) => mockGetAllExpiredItems(...args),
    processExpiredItem: (...args: unknown[]) => mockProcessExpiredItem(...args),
    getFinancialLossesBySKU: (...args: unknown[]) => mockGetFinancialLossesBySKU(...args),
    getFinancialLossesByStoreArea: (...args: unknown[]) =>
      mockGetFinancialLossesByStoreArea(...args),
  };
});

vi.mock('../../services/expired-item.service', () => ({
  ExpiredItemService: function ExpiredItemService(...args: unknown[]) {
    return mockExpiredItemServiceCtor(...args);
  },
}));

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    const userIdHeader = req.get('x-user-id');
    req.userId = userIdHeader ? Number(userIdHeader) : undefined;
    next();
  },
}));

vi.mock('../../middleware/validateRequest', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/rateLimiter', () => ({
  standardLimiter: (_req: any, _res: any, next: any) => next(),
}));

import expiredItemRouter from '../../routes/expired-item.routes';

describe('expired-item.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/expired-items', expiredItemRouter);

  const postProcess = (body: Record<string, unknown>, userId = '7') => {
    const req = request(app).post('/expired-items/process');
    if (userId) {
      req.set('x-user-id', userId);
    }
    return req.send(body);
  };

  const expectProcessBadRequest = async (
    body: Record<string, unknown>,
    message: string,
  ): Promise<void> => {
    const response = await postProcess(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message });
    expect(mockProcessExpiredItem).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllExpiredItems.mockResolvedValue([
      {
        id: 1,
        sku: 'SKU-1',
        productName: 'Milk',
        locationName: 'Cool Room',
      },
    ]);

    mockProcessExpiredItem.mockResolvedValue({
      id: 10,
      inventoryItemId: 1,
      userId: 7,
      action: 'expired',
      unitsDiscarded: 3,
      financialLoss: 15,
      transactionDate: '2026-04-11T00:00:00.000Z',
    });

    mockGetFinancialLossesBySKU.mockResolvedValue([
      { sku: 'SKU-1', productName: 'Milk', totalLoss: 15 },
    ]);
    mockGetFinancialLossesByStoreArea.mockResolvedValue([
      { locationName: 'Cool Room', totalLoss: 15 },
    ]);
  });

  describe('GET /expired-items', () => {
    it('returns expired items list on success', async () => {
      const response = await request(app).get('/expired-items');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 1,
          sku: 'SKU-1',
          productName: 'Milk',
          locationName: 'Cool Room',
        },
      ]);
      expect(mockGetAllExpiredItems).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when fetching expired items fails', async () => {
      mockGetAllExpiredItems.mockRejectedValue(new Error('query failed'));

      const response = await request(app).get('/expired-items');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('POST /expired-items/process', () => {
    it('returns 400 for missing or invalid inventoryItemId', async () => {
      await expectProcessBadRequest(
        { action: 'expired', unitsDiscarded: 2 },
        'Missing or invalid required field: inventoryItemId',
      );
    });

    it('returns 400 for invalid action values', async () => {
      await expectProcessBadRequest(
        { inventoryItemId: 1, action: 'archive' },
        "Action must be either 'sold_through' or 'expired'",
      );
    });

    it('returns 400 when expired action is missing positive unitsDiscarded', async () => {
      await expectProcessBadRequest(
        { inventoryItemId: 1, action: 'expired', unitsDiscarded: 0 },
        'Units discarded must be a positive number when marking as expired',
      );
    });

    it('returns 400 when expired action has decimal unitsDiscarded', async () => {
      await expectProcessBadRequest(
        { inventoryItemId: 1, action: 'expired', unitsDiscarded: 1.5 },
        'Units discarded must be a positive number when marking as expired',
      );
    });

    it('returns 400 when service rejects quantity above available expired units', async () => {
      mockProcessExpiredItem.mockRejectedValue(
        new Error('Cannot discard 3 units; only 2 expired units are available'),
      );

      const response = await postProcess({
        inventoryItemId: 1,
        action: 'expired',
        unitsDiscarded: 3,
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Cannot discard 3 units; only 2 expired units are available',
      });
    });

    it('returns 401 when userId is missing from auth context', async () => {
      const response = await postProcess({ inventoryItemId: 1, action: 'sold_through' }, '');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: No user ID found' });
      expect(mockProcessExpiredItem).not.toHaveBeenCalled();
    });

    it('returns 201 and transaction payload for successful processing', async () => {
      const response = await postProcess({ inventoryItemId: 1, action: 'sold_through' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 10,
        inventoryItemId: 1,
        userId: 7,
        action: 'expired',
        unitsDiscarded: 3,
        financialLoss: 15,
        transactionDate: '2026-04-11T00:00:00.000Z',
      });
      expect(mockProcessExpiredItem).toHaveBeenCalledWith(1, 7, 'sold_through', undefined);
    });

    it('returns 404 when service reports inventory item not found', async () => {
      mockProcessExpiredItem.mockRejectedValue(new Error('Inventory item with ID 1 not found'));

      const response = await postProcess({ inventoryItemId: 1, action: 'sold_through' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Inventory item with ID 1 not found' });
    });

    it('returns 500 when processing fails with unexpected error', async () => {
      mockProcessExpiredItem.mockRejectedValue(new Error('transaction failure'));

      const response = await postProcess({ inventoryItemId: 1, action: 'sold_through' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /expired-items/reports/expired-losses', () => {
    it('returns SKU and store-area loss reports', async () => {
      const response = await request(app).get('/expired-items/reports/expired-losses');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        lossesBySKU: [{ sku: 'SKU-1', productName: 'Milk', totalLoss: 15 }],
        lossesByStoreArea: [{ locationName: 'Cool Room', totalLoss: 15 }],
      });
      expect(mockGetFinancialLossesBySKU).toHaveBeenCalledTimes(1);
      expect(mockGetFinancialLossesByStoreArea).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when report aggregation fails', async () => {
      mockGetFinancialLossesBySKU.mockRejectedValue(new Error('report unavailable'));

      const response = await request(app).get('/expired-items/reports/expired-losses');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });
});

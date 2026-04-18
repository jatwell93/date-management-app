import express from 'express';
import request from 'supertest';

const mockGetAllInventoryItems = jest.fn();
const mockGetInventoryItemById = jest.fn();
const mockGetInventoryItemsByProductId = jest.fn();
const mockGetRecentInventoryItemsByProductId = jest.fn();
const mockGetInventoryItemsByLocationId = jest.fn();
const mockCreateInventoryItem = jest.fn();
const mockUpdateInventoryItem = jest.fn();
const mockDeleteInventoryItem = jest.fn();

const mockGetProductByBarcode = jest.fn();
const mockLogTransaction = jest.fn();

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || undefined;
    const userIdHeader = req.get('x-user-id');
    req.userId = userIdHeader ? Number(userIdHeader) : undefined;
    next();
  },
}));

jest.mock('../../middleware/validateRequest', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/data-integrity.middleware', () => ({
  validateReferentialIntegrity: (_req: any, _res: any, next: any) => next(),
  validateDataConsistency: (_req: any, _res: any, next: any) => next(),
  validateBusinessRules: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  standardLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/feature-gate.middleware', () => ({
  checkUsageLimit: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../services/inventory.service', () => ({
  InventoryService: jest.fn().mockImplementation(() => ({
    getAllInventoryItems: (...args: unknown[]) => mockGetAllInventoryItems(...args),
    getInventoryItemById: (...args: unknown[]) => mockGetInventoryItemById(...args),
    getInventoryItemsByProductId: (...args: unknown[]) => mockGetInventoryItemsByProductId(...args),
    getRecentInventoryItemsByProductId: (...args: unknown[]) =>
      mockGetRecentInventoryItemsByProductId(...args),
    getInventoryItemsByLocationId: (...args: unknown[]) =>
      mockGetInventoryItemsByLocationId(...args),
    createInventoryItem: (...args: unknown[]) => mockCreateInventoryItem(...args),
    updateInventoryItem: (...args: unknown[]) => mockUpdateInventoryItem(...args),
    deleteInventoryItem: (...args: unknown[]) => mockDeleteInventoryItem(...args),
  })),
}));

jest.mock('../../services/product.service', () => ({
  ProductService: jest.fn().mockImplementation(() => ({
    getProductByBarcode: (...args: unknown[]) => mockGetProductByBarcode(...args),
  })),
}));

jest.mock('../../controllers/inventory.controller', () => ({
  logTransaction: (...args: unknown[]) => mockLogTransaction(...args),
}));

import inventoryRouter from '../../routes/inventory.routes';

describe('inventory.routes', () => {
  const app = express();

  app.use(express.json());
  app.use('/inventory-items', inventoryRouter);

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetAllInventoryItems.mockResolvedValue([{ id: 1, organizationId: 'org-1' }]);
    mockGetInventoryItemById.mockResolvedValue({
      id: 1,
      productId: 10,
      locationId: 3,
      status: 'ACTIVE',
      organizationId: 'org-1',
      expiryDate: '2026-12-31',
    });
    mockGetInventoryItemsByProductId.mockResolvedValue([{ id: 11, productId: 10 }]);
    mockGetRecentInventoryItemsByProductId.mockResolvedValue([{ id: 12, productId: 10 }]);
    mockGetInventoryItemsByLocationId.mockResolvedValue([{ id: 13, locationId: 3 }]);

    mockCreateInventoryItem.mockResolvedValue({
      id: 20,
      productId: 10,
      locationId: 3,
      status: 'ACTIVE',
      expiryDate: '2026-12-31',
      organizationId: 'org-1',
    });

    mockUpdateInventoryItem.mockResolvedValue({
      id: 1,
      productId: 10,
      locationId: 3,
      status: 'ACTIVE',
      expiryDate: '2026-12-31',
      organizationId: 'org-1',
    });

    mockDeleteInventoryItem.mockResolvedValue(true);
    mockGetProductByBarcode.mockResolvedValue({ id: 10 });

    mockLogTransaction.mockImplementation((_req: any, res: any) => {
      res.status(201).json({ message: 'Transaction logged' });
    });
  });

  describe('GET /inventory-items', () => {
    it('returns all inventory items', async () => {
      const response = await request(app).get('/inventory-items').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 1, organizationId: 'org-1' }]);
      expect(mockGetAllInventoryItems).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when listing inventory items fails', async () => {
      mockGetAllInventoryItems.mockRejectedValue(new Error('list failed'));

      const response = await request(app).get('/inventory-items').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /inventory-items/:id', () => {
    it('returns 400 for non-numeric id', async () => {
      const response = await request(app)
        .get('/inventory-items/not-a-number')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid inventory item id' });
      expect(mockGetInventoryItemById).not.toHaveBeenCalled();
    });

    it('returns 404 when inventory item does not exist', async () => {
      mockGetInventoryItemById.mockResolvedValue(null);

      const response = await request(app).get('/inventory-items/44').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Inventory item not found' });
    });

    it('returns 403 when inventory item belongs to another organization', async () => {
      mockGetInventoryItemById.mockResolvedValue({ id: 44, organizationId: 'org-2' });

      const response = await request(app).get('/inventory-items/44').set('x-org-id', 'org-1');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: 'Access denied: Item belongs to different organization',
      });
    });

    it('returns inventory item for same organization', async () => {
      const response = await request(app).get('/inventory-items/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: 1,
          organizationId: 'org-1',
        }),
      );
    });

    it('returns 500 when get-by-id throws', async () => {
      mockGetInventoryItemById.mockRejectedValue(new Error('get by id failed'));

      const response = await request(app).get('/inventory-items/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /inventory-items/product/:productId', () => {
    it('returns 400 for invalid product id', async () => {
      const response = await request(app)
        .get('/inventory-items/product/not-a-number')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid product id' });
    });

    it('returns inventory items by product id', async () => {
      const response = await request(app)
        .get('/inventory-items/product/10')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 11, productId: 10 }]);
      expect(mockGetInventoryItemsByProductId).toHaveBeenCalledWith(10);
    });

    it('returns 500 when getting items by product fails', async () => {
      mockGetInventoryItemsByProductId.mockRejectedValue(new Error('product query failed'));

      const response = await request(app)
        .get('/inventory-items/product/10')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /inventory-items/by-barcode/:barcode', () => {
    it('returns 400 for invalid barcode format', async () => {
      const response = await request(app)
        .get('/inventory-items/by-barcode/12-34')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid barcode format' });
      expect(mockGetProductByBarcode).not.toHaveBeenCalled();
    });

    it('returns 404 when barcode product is not found', async () => {
      mockGetProductByBarcode.mockResolvedValue(null);

      const response = await request(app)
        .get('/inventory-items/by-barcode/12345678')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Product not found' });
    });

    it('returns inventory items by barcode', async () => {
      const response = await request(app)
        .get('/inventory-items/by-barcode/1234-5678')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 11, productId: 10 }]);
      expect(mockGetProductByBarcode).toHaveBeenCalledWith('1234-5678');
      expect(mockGetInventoryItemsByProductId).toHaveBeenCalledWith(10);
    });

    it('returns 500 when barcode lookup flow throws', async () => {
      mockGetProductByBarcode.mockRejectedValue(new Error('barcode lookup failed'));

      const response = await request(app)
        .get('/inventory-items/by-barcode/12345678')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /inventory-items/recent/product/:productId', () => {
    it('returns 400 for invalid recent product id', async () => {
      const response = await request(app)
        .get('/inventory-items/recent/product/not-a-number')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid product id' });
    });

    it('uses default limit=5 when query limit is missing', async () => {
      const response = await request(app)
        .get('/inventory-items/recent/product/10')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 12, productId: 10 }]);
      expect(mockGetRecentInventoryItemsByProductId).toHaveBeenCalledWith(10, 5);
    });

    it('uses default limit=5 when query limit is non-positive', async () => {
      const response = await request(app)
        .get('/inventory-items/recent/product/10?limit=0')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(mockGetRecentInventoryItemsByProductId).toHaveBeenCalledWith(10, 5);
    });

    it('uses provided limit when query limit is positive', async () => {
      const response = await request(app)
        .get('/inventory-items/recent/product/10?limit=7')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(mockGetRecentInventoryItemsByProductId).toHaveBeenCalledWith(10, 7);
    });

    it('returns 500 when getting recent items fails', async () => {
      mockGetRecentInventoryItemsByProductId.mockRejectedValue(new Error('recent query failed'));

      const response = await request(app)
        .get('/inventory-items/recent/product/10?limit=2')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /inventory-items/location/:locationId', () => {
    it('returns 400 for invalid location id', async () => {
      const response = await request(app)
        .get('/inventory-items/location/not-a-number')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid location id' });
    });

    it('returns inventory items by location', async () => {
      const response = await request(app)
        .get('/inventory-items/location/3')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 13, locationId: 3 }]);
      expect(mockGetInventoryItemsByLocationId).toHaveBeenCalledWith(3);
    });

    it('returns 500 when location lookup fails', async () => {
      mockGetInventoryItemsByLocationId.mockRejectedValue(new Error('location query failed'));

      const response = await request(app)
        .get('/inventory-items/location/3')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('POST /inventory-items', () => {
    const validPayload = {
      productId: 10,
      expiryDate: '2026-12-31',
      locationId: 3,
      status: 'ACTIVE',
    };

    it('returns 400 when required inventory fields are missing', async () => {
      const response = await request(app)
        .post('/inventory-items')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ productId: 10, locationId: 3 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Missing required inventory item fields' });
      expect(mockCreateInventoryItem).not.toHaveBeenCalled();
    });

    it('returns 401 when user id is missing from auth context', async () => {
      const response = await request(app)
        .post('/inventory-items')
        .set('x-org-id', 'org-1')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: No user ID found' });
      expect(mockCreateInventoryItem).not.toHaveBeenCalled();
    });

    it('creates inventory item successfully', async () => {
      const response = await request(app)
        .post('/inventory-items')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: 20,
          productId: 10,
          locationId: 3,
        }),
      );
      expect(mockCreateInventoryItem).toHaveBeenCalledWith(validPayload, 7);
    });

    it('returns 400 when create fails due to missing location', async () => {
      mockCreateInventoryItem.mockRejectedValue(new Error('Location does not exist'));

      const response = await request(app)
        .post('/inventory-items')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Location does not exist' });
    });

    it('returns 500 for unexpected create errors', async () => {
      mockCreateInventoryItem.mockRejectedValue(new Error('create failed'));

      const response = await request(app)
        .post('/inventory-items')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('PUT /inventory-items/:id', () => {
    it('returns 400 for invalid inventory item id', async () => {
      const response = await request(app)
        .put('/inventory-items/not-a-number')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ status: 'EXPIRED' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid inventory item id' });
    });

    it('returns 404 when existing item is not found before update', async () => {
      mockGetInventoryItemById.mockResolvedValue(null);

      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ status: 'EXPIRED' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Inventory item not found' });
    });

    it('returns 403 when updating item owned by another organization', async () => {
      mockGetInventoryItemById.mockResolvedValue({ id: 1, organizationId: 'org-2' });

      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ status: 'EXPIRED' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: 'Access denied: Item belongs to different organization',
      });
    });

    it('returns 401 when updating without user id context', async () => {
      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .send({ status: 'EXPIRED' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: No user ID found' });
      expect(mockUpdateInventoryItem).not.toHaveBeenCalled();
    });

    it('updates inventory item with all mutable fields', async () => {
      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({
          productId: 22,
          expiryDate: '2027-01-01',
          locationId: 8,
          status: 'EXPIRED',
        });

      expect(response.status).toBe(200);
      expect(mockUpdateInventoryItem).toHaveBeenCalledWith(
        1,
        {
          productId: 22,
          expiryDate: '2027-01-01',
          locationId: 8,
          status: 'EXPIRED',
        },
        7,
      );
    });

    it('updates inventory item with partial payload', async () => {
      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ status: 'NEAR_EXPIRY' });

      expect(response.status).toBe(200);
      expect(mockUpdateInventoryItem).toHaveBeenCalledWith(1, { status: 'NEAR_EXPIRY' }, 7);
    });

    it('returns 404 when update service returns null', async () => {
      mockUpdateInventoryItem.mockResolvedValue(null);

      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ status: 'NEAR_EXPIRY' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Inventory item not found' });
    });

    it('returns 500 when update fails unexpectedly', async () => {
      mockUpdateInventoryItem.mockRejectedValue(new Error('update failed'));

      const response = await request(app)
        .put('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ status: 'EXPIRED' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('DELETE /inventory-items/:id', () => {
    it('returns 400 for invalid inventory item id', async () => {
      const response = await request(app)
        .delete('/inventory-items/not-a-number')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid inventory item id' });
    });

    it('returns 404 when existing item is not found before delete', async () => {
      mockGetInventoryItemById.mockResolvedValue(null);

      const response = await request(app)
        .delete('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Inventory item not found' });
    });

    it('returns 403 when deleting item from another organization', async () => {
      mockGetInventoryItemById.mockResolvedValue({ id: 1, organizationId: 'org-2' });

      const response = await request(app)
        .delete('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: 'Access denied: Item belongs to different organization',
      });
    });

    it('returns 401 when deleting without user id context', async () => {
      const response = await request(app).delete('/inventory-items/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: No user ID found' });
      expect(mockDeleteInventoryItem).not.toHaveBeenCalled();
    });

    it('returns 404 when delete service reports item was not deleted', async () => {
      mockDeleteInventoryItem.mockResolvedValue(false);

      const response = await request(app)
        .delete('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Inventory item not found' });
    });

    it('deletes inventory item successfully', async () => {
      const response = await request(app)
        .delete('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Inventory item deleted successfully' });
      expect(mockDeleteInventoryItem).toHaveBeenCalledWith(1, 7);
    });

    it('returns 500 when delete fails unexpectedly', async () => {
      mockDeleteInventoryItem.mockRejectedValue(new Error('delete failed'));

      const response = await request(app)
        .delete('/inventory-items/1')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('POST /inventory-items/transaction', () => {
    it('delegates to logTransaction middleware', async () => {
      const response = await request(app)
        .post('/inventory-items/transaction')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '7')
        .send({ itemId: 1, action: 'ADJUST', quantity: 2 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ message: 'Transaction logged' });
      expect(mockLogTransaction).toHaveBeenCalledTimes(1);
    });
  });
});

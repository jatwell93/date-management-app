import { Request, Response, NextFunction } from 'express';
import {
  validateReferentialIntegrity,
  validateDataConsistency,
  validateBusinessRules,
} from '../../middleware/data-integrity.middleware';

// getDb/releaseDb are mocked rather than hitting the shared SQLite fixture: these
// middlewares are pure request guards, and mocking is the only way to drive the
// "database threw" path deterministically.
const { getDbMock, releaseDbMock, getMock, prepareMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const prepareMock = vi.fn(() => ({ get: getMock }));
  return {
    getDbMock: vi.fn(() => ({ prepare: prepareMock })),
    releaseDbMock: vi.fn(),
    getMock,
    prepareMock,
  };
});

vi.mock('../../database', () => ({
  getDb: getDbMock,
  releaseDb: releaseDbMock,
}));

describe('Data Integrity Middleware', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  const buildReq = (path: string, method: string, body: Record<string, unknown> = {}) =>
    ({ path, method, body }) as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockReturnValue({ get: getMock });
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  describe('validateReferentialIntegrity', () => {
    it('passes through routes it does not guard', async () => {
      const req = buildReq('/api/products', 'POST', { productId: 1 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(prepareMock).not.toHaveBeenCalled();
    });

    it('ignores non-POST requests to a guarded route', async () => {
      const req = buildReq('/api/inventory-items', 'GET', { productId: 1 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(prepareMock).not.toHaveBeenCalled();
    });

    it('rejects an inventory item referencing a missing product', async () => {
      getMock.mockReturnValueOnce(undefined);
      const req = buildReq('/api/inventory-items', 'POST', { productId: 999 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Referenced product does not exist' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('rejects an inventory item referencing a missing store location', async () => {
      getMock
        .mockReturnValueOnce({ id: 1 }) // product exists
        .mockReturnValueOnce(undefined); // location does not
      const req = buildReq('/api/inventory-items', 'POST', { productId: 1, locationId: 42 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Referenced store location does not exist',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('accepts an inventory item whose references all resolve', async () => {
      getMock.mockReturnValue({ id: 1 });
      const req = buildReq('/api/inventory-items', 'POST', { productId: 1, locationId: 2 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('accepts an inventory item that references nothing', async () => {
      const req = buildReq('/api/inventory-items', 'POST', { quantity: 5 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(prepareMock).not.toHaveBeenCalled();
    });

    it('rejects an audit log referencing a missing user', async () => {
      getMock.mockReturnValueOnce(undefined);
      const req = buildReq('/api/audit-log', 'POST', { user_id: 77 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Referenced user does not exist' });
    });

    it('rejects an audit log referencing a missing inventory item', async () => {
      getMock
        .mockReturnValueOnce({ id: 1 }) // user exists
        .mockReturnValueOnce(undefined); // inventory item does not
      const req = buildReq('/api/audit-log', 'POST', { user_id: 1, inventory_item_id: 55 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Referenced inventory item does not exist',
      });
    });

    it('accepts an audit log whose references all resolve', async () => {
      getMock.mockReturnValue({ id: 1 });
      const req = buildReq('/api/audit-log', 'POST', { user_id: 1, inventory_item_id: 2 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('returns 500 and still releases the connection when the query throws', async () => {
      prepareMock.mockImplementation(() => {
        throw new Error('database is locked');
      });
      const req = buildReq('/api/inventory-items', 'POST', { productId: 1 });

      await validateReferentialIntegrity(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database validation failed' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(releaseDbMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateDataConsistency', () => {
    it('passes through routes it does not guard', () => {
      const req = buildReq('/api/products', 'POST', {});

      validateDataConsistency(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(getDbMock).not.toHaveBeenCalled();
    });

    it('skips the duplicate check unless product, expiry and location are all present', () => {
      const req = buildReq('/api/inventory-items', 'POST', {
        productId: 1,
        expiryDate: '2027-01-01',
      });

      validateDataConsistency(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(getDbMock).not.toHaveBeenCalled();
    });

    it('rejects a duplicate product/expiry/location triple with 409', () => {
      getMock.mockReturnValueOnce({ id: 7 });
      const req = buildReq('/api/inventory-items', 'POST', {
        productId: 1,
        expiryDate: '2027-01-01',
        locationId: 2,
      });

      validateDataConsistency(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockNext).not.toHaveBeenCalled();
      expect(releaseDbMock).toHaveBeenCalledTimes(1);
    });

    it('accepts a non-duplicate item', () => {
      getMock.mockReturnValueOnce(undefined);
      const req = buildReq('/api/inventory-items', 'POST', {
        productId: 1,
        expiryDate: '2027-01-01',
        locationId: 2,
      });

      validateDataConsistency(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('does not continue to the route handler after a failed consistency check', () => {
      // Regression guard: the catch block must return. `next()` sits outside the
      // try, so falling through would run the handler after the 500 was sent.
      prepareMock.mockImplementation(() => {
        throw new Error('database is locked');
      });
      const req = buildReq('/api/inventory-items', 'POST', {
        productId: 1,
        expiryDate: '2027-01-01',
        locationId: 2,
      });

      validateDataConsistency(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Data consistency check failed' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(releaseDbMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateBusinessRules', () => {
    const yearsFromNow = (years: number, offsetDays = 0) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setFullYear(d.getFullYear() + years);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString();
    };

    it('rejects an expiry date more than 5 years out', () => {
      const req = buildReq('/api/inventory-items', 'POST', { expiryDate: yearsFromNow(5, 1) });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Expiry date cannot be more than 5 years in the future',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('accepts an expiry date exactly 5 years out (boundary is inclusive)', () => {
      const req = buildReq('/api/inventory-items', 'POST', { expiryDate: yearsFromNow(5) });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('applies the expiry rule to updates as well as creates', () => {
      const req = buildReq('/api/inventory-items', 'PUT', { expiryDate: yearsFromNow(5, 1) });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('ignores an inventory request with no expiry date', () => {
      const req = buildReq('/api/inventory-items', 'POST', { quantity: 3 });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('ignores methods the expiry rule does not cover', () => {
      const req = buildReq('/api/inventory-items', 'DELETE', { expiryDate: yearsFromNow(9) });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('rejects a negative product cost price', () => {
      const req = buildReq('/api/products', 'POST', { cost_price: -0.01 });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Product cost price cannot be negative',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('accepts a zero cost price', () => {
      const req = buildReq('/api/products', 'PUT', { cost_price: 0 });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('ignores a product request with no cost price', () => {
      const req = buildReq('/api/products', 'POST', { name: 'Widget' });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('lets a non-numeric cost price through to schema validation', () => {
      // parseFloat('abc') is NaN and NaN < 0 is false, so this guard defers to
      // the input validation layer rather than rejecting here.
      const req = buildReq('/api/products', 'POST', { cost_price: 'abc' });

      validateBusinessRules(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});

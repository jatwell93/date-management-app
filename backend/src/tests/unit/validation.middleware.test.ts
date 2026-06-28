import { Request, Response, NextFunction } from 'express';
import {
  validateProductInput,
  validateInventoryItemInput,
  validateUserInput,
  validateStoreAreaInput,
} from '../../middleware/validation.middleware';

describe('Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
  });

  describe('validateProductInput', () => {
    it('should call next() for valid product data', () => {
      mockReq = {
        body: {
          barcode: '1234567890123',
          sku: 'TEST-SKU-001',
          name: 'Test Product',
          cost_price: 19.99,
        },
      };

      validateProductInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid barcode format', () => {
      mockReq = {
        body: {
          barcode: '123', // Too short
          sku: 'TEST-SKU-001',
          name: 'Test Product',
          cost_price: 19.99,
        },
      };

      validateProductInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid barcode format' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid SKU format', () => {
      mockReq = {
        body: {
          barcode: '1234567890123',
          sku: 'A'.repeat(51), // Too long
          name: 'Test Product',
          cost_price: 19.99,
        },
      };

      validateProductInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid SKU format' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid product name with HTML tags', () => {
      mockReq = {
        body: {
          barcode: '1234567890123',
          sku: 'TEST-SKU-001',
          name: 'Test <script>alert("xss")</script> Product', // Contains HTML
          cost_price: 19.99,
        },
      };

      validateProductInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid product name format' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid cost price', () => {
      mockReq = {
        body: {
          barcode: '1234567890123',
          sku: 'TEST-SKU-001',
          name: 'Test Product',
          cost_price: -5, // Negative cost
        },
      };

      validateProductInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Cost price must be a positive number' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('validateInventoryItemInput', () => {
    it('should call next() for valid inventory item data', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      mockReq = {
        body: {
          product_id: 1,
          expiry_date: futureDateStr,
          location_id: 1,
        },
      };

      validateInventoryItemInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid expiry date format', () => {
      mockReq = {
        body: {
          product_id: 1,
          expiry_date: '31/12/2025', // Wrong format
          location_id: 1,
        },
      };

      validateInventoryItemInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid expiry date format. Use YYYY-MM-DD.',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid product_id', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      mockReq = {
        body: {
          product_id: 0, // Invalid (must be positive)
          expiry_date: futureDateStr,
          location_id: 1,
        },
      };

      validateInventoryItemInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Product ID must be a positive integer' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('validateUserInput', () => {
    it('should call next() for valid user data', () => {
      mockReq = {
        body: {
          pin: '1234',
          role: 'Manager',
        },
      };

      validateUserInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid PIN (too short)', () => {
      mockReq = {
        body: {
          pin: '123', // Too short
          role: 'Manager',
        },
      };

      validateUserInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'PIN must be 4-6 digits' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid PIN (too long)', () => {
      mockReq = {
        body: {
          pin: '1234567', // Too long
          role: 'Manager',
        },
      };

      validateUserInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'PIN must be 4-6 digits' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid PIN (contains non-digits)', () => {
      mockReq = {
        body: {
          pin: '12a4', // Contains letter
          role: 'Manager',
        },
      };

      validateUserInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'PIN must be 4-6 digits' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid role', () => {
      mockReq = {
        body: {
          pin: '1234',
          role: 'Admin', // Invalid role
        },
      };

      validateUserInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Role must be either "Manager" or "Team Member"',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('validateStoreAreaInput', () => {
    it('should call next() for valid store area data', () => {
      mockReq = {
        body: {
          name: 'Test Area',
        },
      };

      validateStoreAreaInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 400 for store area name with HTML tags', () => {
      mockReq = {
        body: {
          name: 'Test <script>alert("xss")</script> Area',
        },
      };

      validateStoreAreaInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid store area name format' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

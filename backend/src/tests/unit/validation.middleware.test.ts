import { Request, Response, NextFunction } from 'express';
import { validateProductInput, validateInventoryItemInput, validateUserInput, validateStoreAreaInput, validateTransactionInput } from '../../middleware/validation.middleware';

describe('Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
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
      mockReq = {
        body: {
          product_id: 1,
          expiry_date: '2025-12-31',
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
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid expiry date format. Use YYYY-MM-DD.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid product_id', () => {
      mockReq = {
        body: {
          product_id: 0, // Invalid (must be positive)
          expiry_date: '2025-12-31',
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
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Role must be either "Manager" or "Team Member"' });
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

  describe('validateTransactionInput', () => {
    it('should call next() for valid transaction data', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should call next() for valid transaction data with notes', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'out',
          quantity_change: 5,
          notes: 'Test transaction notes',
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 400 for missing inventory_item_id', () => {
      mockReq = {
        body: {
          user_id: 1,
          type: 'in',
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'inventory_item_id is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid inventory_item_id', () => {
      mockReq = {
        body: {
          inventory_item_id: 0, // Must be positive
          user_id: 1,
          type: 'in',
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'inventory_item_id must be a positive integer' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for missing user_id', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          type: 'in',
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'user_id is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid user_id', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: -1, // Must be positive
          type: 'in',
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'user_id must be a positive integer' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for missing type', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'type is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid type', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'invalid', // Must be 'in', 'out', or 'adjustment'
          quantity_change: 10,
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'type must be one of: in, out, adjustment' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for missing quantity_change', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'quantity_change is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid quantity_change (not a number)', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 'not a number',
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'quantity_change must be a valid number' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for notes with HTML tags', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 10,
          notes: 'Test <script>alert("xss")</script>',
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'notes cannot contain HTML tags' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for notes exceeding 500 characters', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 10,
          notes: 'a'.repeat(501), // 501 characters
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'notes must not exceed 500 characters' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid notes type', () => {
      mockReq = {
        body: {
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 10,
          notes: 123, // Should be string
        },
      };

      validateTransactionInput(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'notes must be a string' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
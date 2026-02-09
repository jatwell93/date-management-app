/**
 * Tests for Zod Request Validation Middleware (Phase 13 Security Hardening)
 *
 * Tests the validateRequest middleware to ensure:
 * - Valid requests pass through
 * - Invalid requests are rejected with proper error format
 * - Field-level errors are correctly reported
 * - Edge cases are handled
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  validateRequest,
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validateRequest';
import { ValidationError } from '../../errors';

describe('Zod Request Validation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: {},
      params: {},
      query: {},
    };
    mockResponse = {};
    mockNext = jest.fn();
  });

  describe('validateRequest - Combined Validation', () => {
    const schema = z.object({
      body: z.object({
        email: z.string().email('Invalid email format'),
        age: z.number().int().positive('Age must be positive'),
      }),
      params: z.object({
        id: z.string().regex(/^\d+$/, 'ID must be numeric'),
      }),
      query: z.object({
        page: z.string().regex(/^\d+$/, 'Page must be numeric').optional(),
      }),
    });

    it('should pass validation with valid request', async () => {
      mockRequest = {
        body: { email: 'test@example.com', age: 25 },
        params: { id: '123' },
        query: { page: '1' },
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).not.toHaveBeenCalledWith(expect.any(Error));
    });

    it('should fail validation with invalid body', async () => {
      mockRequest = {
        body: { email: 'invalid-email', age: -5 },
        params: { id: '123' },
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      expect(error.errors).toBeDefined();
      expect(error.errors!.length).toBeGreaterThan(0);
      expect(error.errors![0]).toHaveProperty('field');
      expect(error.errors![0]).toHaveProperty('message');
    });

    it('should fail validation with invalid params', async () => {
      mockRequest = {
        body: { email: 'test@example.com', age: 25 },
        params: { id: 'abc' },
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      expect(error.errors).toBeDefined();
      expect(error.errors!.some((e) => e.field === 'id')).toBe(true);
    });

    it('should include multiple field errors', async () => {
      mockRequest = {
        body: { email: 'invalid-email', age: -5 },
        params: { id: 'abc' },
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      expect(error.errors!.length).toBeGreaterThanOrEqual(3); // email, age, id
    });
  });

  describe('validateBody - Body Only Validation', () => {
    const schema = z.object({
      username: z.string().min(3, 'Username must be at least 3 characters'),
      password: z.string().min(8, 'Password must be at least 8 characters'),
    });

    it('should pass validation with valid body', async () => {
      mockRequest = {
        body: { username: 'testuser', password: 'password123' },
      };

      const middleware = validateBody(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).not.toHaveBeenCalledWith(expect.any(Error));
    });

    it('should fail validation with short username', async () => {
      mockRequest = {
        body: { username: 'ab', password: 'password123' },
      };

      const middleware = validateBody(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      expect(error.errors!.some((e) => e.field === 'username')).toBe(true);
    });

    it('should fail validation with short password', async () => {
      mockRequest = {
        body: { username: 'testuser', password: 'short' },
      };

      const middleware = validateBody(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      expect(error.errors!.some((e) => e.field === 'password')).toBe(true);
    });

    it('should fail validation with missing required fields', async () => {
      mockRequest = {
        body: {},
      };

      const middleware = validateBody(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      expect(error.errors!.length).toBe(2); // username and password
    });
  });

  describe('validateParams - Params Only Validation', () => {
    const schema = z.object({
      id: z.string().regex(/^\d+$/, 'ID must be numeric').transform(Number),
    });

    it('should pass validation with valid params', async () => {
      mockRequest = {
        params: { id: '123' },
      };

      const middleware = validateParams(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockRequest.params!.id).toBe(123); // Transformed to number
    });

    it('should fail validation with non-numeric id', async () => {
      mockRequest = {
        params: { id: 'abc' },
      };

      const middleware = validateParams(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('validateQuery - Query Only Validation', () => {
    const schema = z.object({
      page: z.string().regex(/^\d+$/).optional().default('1'),
      limit: z.string().regex(/^\d+$/).optional().default('20'),
    });

    it('should pass validation with valid query params', async () => {
      mockRequest = {
        query: { page: '2', limit: '50' },
      };

      const middleware = validateQuery(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockRequest.query!.page).toBe('2');
      expect(mockRequest.query!.limit).toBe('50');
    });

    it('should apply defaults for missing query params', async () => {
      mockRequest = {
        query: {},
      };

      const middleware = validateQuery(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockRequest.query!.page).toBe('1');
      expect(mockRequest.query!.limit).toBe('20');
    });

    it('should fail validation with invalid query params', async () => {
      mockRequest = {
        query: { page: 'abc' },
      };

      const middleware = validateQuery(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('Error Format Compliance', () => {
    const schema = z.object({
      body: z.object({
        email: z.string().email(),
        pin: z.string().regex(/^\d{4,6}$/),
      }),
    });

    it('should return errors in standardized format', async () => {
      mockRequest = {
        body: { email: 'invalid', pin: '123' },
        params: {},
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;

      // Check error structure matches { errors: [{ field, message }] }
      expect(error.errors).toBeDefined();
      expect(Array.isArray(error.errors)).toBe(true);
      error.errors!.forEach((err) => {
        expect(err).toHaveProperty('field');
        expect(err).toHaveProperty('message');
        expect(typeof err.field).toBe('string');
        expect(typeof err.message).toBe('string');
      });
    });

    it('should include field names in error messages', async () => {
      mockRequest = {
        body: { email: 'invalid-email', pin: '12' },
        params: {},
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      const error = (mockNext as jest.Mock).mock.calls[0][0] as ValidationError;
      const fields = error.errors!.map((e) => e.field);

      expect(fields).toContain('email');
      expect(fields).toContain('pin');
    });
  });

  describe('Edge Cases', () => {
    it('should handle nested object validation', async () => {
      const schema = z.object({
        body: z.object({
          user: z.object({
            name: z.string(),
            address: z.object({
              street: z.string(),
              city: z.string(),
            }),
          }),
        }),
      });

      mockRequest = {
        body: {
          user: {
            name: 'John',
            address: {
              street: '123 Main St',
              city: 'Anytown',
            },
          },
        },
        params: {},
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle array validation', async () => {
      const schema = z.object({
        body: z.object({
          items: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
            }),
          ),
        }),
      });

      mockRequest = {
        body: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
          ],
        },
        params: {},
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle empty body gracefully', async () => {
      const schema = z.object({
        body: z.object({
          optional: z.string().optional(),
        }),
      });

      mockRequest = {
        body: {},
        params: {},
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass through non-Zod errors', async () => {
      const schema = z.object({
        body: z.object({
          field: z.string(),
        }),
      });

      // Force a non-Zod error by mocking schema.parseAsync
      jest.spyOn(schema, 'parseAsync').mockRejectedValue(new Error('Unexpected error'));

      mockRequest = {
        body: { field: 'value' },
        params: {},
        query: {},
      };

      const middleware = validateRequest(schema);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toBe('Unexpected error');
      expect(error).not.toBeInstanceOf(ValidationError);
    });
  });
});

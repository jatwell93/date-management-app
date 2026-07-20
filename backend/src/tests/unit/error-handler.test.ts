/**
 * Tests for Enhanced Error Handler Middleware (Phase 13)
 */

import { Request, Response, NextFunction } from 'express';
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  InternalError,
  PolicyValidationError,
} from '../../errors';
import { errorHandler } from '../../middleware/error.middleware';

describe('Error Handler Middleware - Phase 13', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnThis();

    mockRes = {
      status: statusMock,
      json: jsonMock,
      headersSent: false,
    };

    mockReq = {
      url: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('Test User Agent'),
    };

    mockNext = vi.fn();
  });

  describe('Custom Error Handling', () => {
    it('should handle ValidationError with 400 status', () => {
      const error = new ValidationError('Invalid input', [
        { field: 'email', message: 'Invalid email format' },
      ]);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        statusCode: 400,
        errors: [{ field: 'email', message: 'Invalid email format' }],
      });
    });

    it('should preserve structured policy validation errors with 422 status', () => {
      const error = new PolicyValidationError('Supplier policy is invalid', [
        { field: 'contact', message: 'Add a contact method' },
      ]);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(422);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'POLICY_VALIDATION_ERROR',
        message: 'Supplier policy is invalid',
        statusCode: 422,
        errors: [{ field: 'contact', message: 'Add a contact method' }],
      });
    });

    it('should handle AuthenticationError with 401 status', () => {
      const error = new AuthenticationError('Invalid token');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'AUTHENTICATION_ERROR',
        message: 'Invalid token',
        statusCode: 401,
      });
    });

    it('should handle AuthorizationError with 403 status', () => {
      const error = new AuthorizationError('Insufficient permissions');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'AUTHORIZATION_ERROR',
        message: 'Insufficient permissions',
        statusCode: 403,
      });
    });

    it('should handle NotFoundError with 404 status', () => {
      const error = new NotFoundError('User not found');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'NOT_FOUND_ERROR',
        message: 'User not found',
        statusCode: 404,
      });
    });

    it('should handle ConflictError with 409 status', () => {
      const error = new ConflictError('Email already in use');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'CONFLICT_ERROR',
        message: 'Email already in use',
        statusCode: 409,
      });
    });

    it('should handle InternalError with 500 status', () => {
      const error = new InternalError('Database connection failed');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'INTERNAL_ERROR',
        message: 'Database connection failed',
        statusCode: 500,
      });
    });
  });

  describe('Generic Error Handling', () => {
    it('should handle generic Error with 500 status in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Unexpected error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        statusCode: 500,
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should expose error message in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Detailed error message');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'INTERNAL_ERROR',
        message: 'Detailed error message',
        statusCode: 500,
        stack: expect.any(String),
      });

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Edge Cases', () => {
    it('should call next if headers already sent', () => {
      mockRes.headersSent = true;
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(statusMock).not.toHaveBeenCalled();
      expect(jsonMock).not.toHaveBeenCalled();
    });

    it('should handle ValidationError with empty errors array', () => {
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        statusCode: 400,
      });
    });
  });

  describe('Context Logging', () => {
    it('should include request context in error logs', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});

/**
 * Custom Error Classes for Phase 13 Security Hardening
 *
 * These errors provide semantic meaning and consistent HTTP status codes
 * across the application. Use these instead of generic Error.
 */

export class BaseError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Error.captureStackTrace(this);
  }
}

/**
 * 400 Bad Request - Input validation failures
 */
export class ValidationError extends BaseError {
  public readonly errors?: Array<{ field: string; message: string }>;

  constructor(message: string, errors?: Array<{ field: string; message: string }>) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

/**
 * 422 Unprocessable Entity - a syntactically valid supplier policy violates
 * the policy domain rules. Kept distinct from request-shape validation so
 * clients can render field guidance without treating it as a malformed body.
 */
export class PolicyValidationError extends BaseError {
  public readonly errors: Array<{ field: string; message: string }>;

  constructor(
    message = 'Supplier policy is invalid',
    errors: Array<{ field: string; message: string }> = [],
  ) {
    super(message, 422, 'POLICY_VALIDATION_ERROR');
    this.errors = errors;
  }
}

/**
 * 401 Unauthorized - Missing or invalid authentication
 */
export class AuthenticationError extends BaseError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * 403 Forbidden - Insufficient permissions
 */
export class AuthorizationError extends BaseError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * 402 Payment Required - Subscription or usage limit reached
 */
export class PaymentRequiredError extends BaseError {
  constructor(message = 'Payment required') {
    super(message, 402, 'PAYMENT_REQUIRED');
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundError extends BaseError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR');
  }
}

/**
 * 409 Conflict - Duplicate resource or constraint violation
 */
export class ConflictError extends BaseError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

/**
 * 500 Internal Server Error - Unexpected server errors
 */
export class InternalError extends BaseError {
  constructor(message = 'An unexpected error occurred', isOperational = false) {
    super(message, 500, 'INTERNAL_ERROR', isOperational);
  }
}

/**
 * Type guard to check if error is a custom BaseError
 */
export function isBaseError(error: unknown): error is BaseError {
  return error instanceof BaseError;
}

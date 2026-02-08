/**
 * Zod-based Request Validation Middleware for Phase 13 Security Hardening
 * 
 * Validates request body, params, and query parameters using Zod schemas.
 * Returns standardized validation errors in the format:
 * { errors: [{ field: "fieldName", message: "error message" }] }
 */

import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';
import { ValidationError } from '../errors';

/**
 * Creates a middleware that validates request against a Zod schema
 * @param schema - Zod schema to validate against (can validate body, params, query)
 * @returns Express middleware function
 * 
 * @example
 * ```typescript
 * import { validateRequest } from './middleware/validateRequest';
 * import { loginSchema } from './schemas';
 * 
 * router.post('/login', validateRequest(loginSchema), loginController);
 * ```
 */
export const validateRequest = (schema: ZodType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate the request object containing body, params, and query
      await schema.parseAsync({
        body: req.body,
        params: req.params,
        query: req.query,
      });

      // If validation passes, continue to next middleware
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Transform Zod errors into our standardized format
        const validationErrors = error.issues.map((err) => {
          // Extract the field name from the path
          // Path is like: ['body', 'pin'] or ['query', 'page']
          const path = err.path.filter((p) => p !== 'body' && p !== 'params' && p !== 'query');
          const field = path.join('.');

          return {
            field: field || 'unknown',
            message: err.message,
          };
        });

        // Use our custom ValidationError class
        next(new ValidationError('Validation failed', validationErrors));
      } else {
        // Pass unexpected errors to error handler
        next(error);
      }
    }
  };
};

/**
 * Validates only the request body
 * @param schema - Zod schema for the body
 * 
 * @example
 * ```typescript
 * import { validateBody } from './middleware/validateRequest';
 * import { z } from 'zod';
 * 
 * const schema = z.object({
 *   email: z.string().email(),
 *   password: z.string().min(8),
 * });
 * 
 * router.post('/register', validateBody(schema), registerController);
 * ```
 */
export const validateBody = (schema: ZodType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        next(new ValidationError('Validation failed', validationErrors));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Validates only the request params
 * @param schema - Zod schema for the params
 */
export const validateParams = (schema: ZodType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = (await schema.parseAsync(req.params)) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        next(new ValidationError('Validation failed', validationErrors));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Validates only the request query
 * @param schema - Zod schema for the query
 */
export const validateQuery = (schema: ZodType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = (await schema.parseAsync(req.query)) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        next(new ValidationError('Validation failed', validationErrors));
      } else {
        next(error);
      }
    }
  };
};

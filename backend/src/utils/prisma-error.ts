/**
 * Type-safe Prisma error handling utilities
 * Provides centralized error code checking without using `any`
 */

// Prisma error codes
export const PRISMA_ERROR_CODES = {
  NOT_FOUND: 'P2025',
  UNIQUE_CONSTRAINT: 'P2002',
};

/**
 * Type guard to check if an error is a Prisma error
 */
export function isPrismaError(error: unknown): error is { code: string; message: string } {
  return (
    error instanceof Object &&
    'code' in error &&
    'message' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

/**
 * Check if error is Prisma "not found" (record doesn't exist)
 */
export function isPrismaNotFound(error: unknown): boolean {
  return isPrismaError(error) && error.code === PRISMA_ERROR_CODES.NOT_FOUND;
}

/**
 * Check if error matches a specific Prisma error code
 */
export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return isPrismaError(error) && error.code === code;
}

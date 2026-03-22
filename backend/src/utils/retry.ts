/**
 * Exponential Backoff Retry Utility
 *
 * Provides utilities for retrying operations with exponential backoff and jitter.
 * Useful for handling transient failures in serverless environments.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add random jitter to delay (default: true) */
  useJitter?: boolean;
  /** Regex to match errors that should be retried (default: connection timeout errors) */
  retryableErrorPattern?: RegExp;
}

/**
 * Retry an async operation with exponential backoff
 *
 * @param operation - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the operation
 * @throws Last error if all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => database.user.findFirst({ where: { id: 1 } }),
 *   { maxAttempts: 3, initialDelayMs: 100 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    useJitter = true,
    retryableErrorPattern = /(?:connection|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT)/i,
  } = options;

  let lastError: Error | null = null;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;

      // Check if the error is retryable
      const isRetryable = retryableErrorPattern.test(errorMessage);

      // Don't retry non-retryable errors
      if (!isRetryable) {
        throw lastError;
      }

      // Don't wait after the final attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate delay with optional jitter
      let currentDelayMs = Math.min(delayMs, maxDelayMs);
      if (useJitter) {
        // Add random jitter: ±20% of delay
        const jitter = currentDelayMs * 0.2 * (Math.random() - 0.5) * 2;
        currentDelayMs = Math.max(1, currentDelayMs + jitter);
      }

      console.warn(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}. ` +
          `Retrying in ${currentDelayMs.toFixed(0)}ms...`,
      );

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, currentDelayMs));

      // Increase delay for next attempt
      delayMs *= backoffMultiplier;
    }
  }

  // All retries exhausted
  throw lastError || new Error('Operation failed after max retries');
}

/**
 * Wrapper for database operations with automatic retry on connection errors
 *
 * @param operation - Database operation to execute
 * @returns Result of the operation
 *
 * @example
 * ```typescript
 * const user = await withDatabaseRetry(
 *   () => database.user.findFirst({ where: { id: 1 } })
 * );
 * ```
 */
export async function withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
  return retryWithBackoff(operation, {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 2000,
    backoffMultiplier: 2,
    useJitter: true,
    // Match database connection errors
    retryableErrorPattern:
      /(?:connection|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|pool|Hyperdrive)/i,
  });
}

/**
 * Wrapper for API requests with automatic retry on transient errors
 *
 * @param operation - HTTP request to execute
 * @returns Result of the request
 *
 * @example
 * ```typescript
 * const response = await withApiRetry(
 *   () => fetch('https://api.example.com/data')
 * );
 * ```
 */
export async function withApiRetry<T>(operation: () => Promise<T>): Promise<T> {
  return retryWithBackoff(operation, {
    maxAttempts: 3,
    initialDelayMs: 200,
    maxDelayMs: 3000,
    backoffMultiplier: 2,
    useJitter: true,
    // Match network and timeout errors
    retryableErrorPattern: /(?:timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch|network)/i,
  });
}

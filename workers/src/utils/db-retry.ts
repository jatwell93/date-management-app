/**
 * Workers Database Retry Wrapper
 *
 * Wraps Neon serverless driver operations with exponential backoff retry logic
 * for handling transient connection failures in Cloudflare Workers.
 */

/**
 * Minimal tagged-template signature used by `createRetryableSql`.
 *
 * We keep this local instead of importing a concrete Neon type so this helper
 * can wrap any SQL-style template function and return-type without coupling to
 * a specific driver export surface.
 */
type SqlTaggedTemplate<TResult> = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<TResult>;

export interface WorkersDbRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Execute a Neon SQL query with automatic retry on connection errors
 *
 * This wrapper adds exponential backoff retry logic to Neon serverless driver operations,
 * helping recover from transient connection issues in Workers environments.
 *
 * @param sqlOperation - Function that returns a Neon SQL query
 * @param options - Retry configuration
 * @returns Query result
 * @throws Last error if all retries exhausted
 *
 * @example
 * ```typescript
 * const results = await withNeonRetry(
 *   () => sql`SELECT * FROM products WHERE organization_id = ${orgId}`,
 *   { maxAttempts: 3 }
 * );
 * ```
 */
export async function withNeonRetry<T>(
  sqlOperation: () => Promise<T>,
  options: WorkersDbRetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 100, maxDelayMs = 2000 } = options;

  let lastError: Error | null = null;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sqlOperation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;

      // Check if error is a transient connection error
      const isTransient =
        /(?:connection|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|pool|Hyperdrive)/i.test(
          errorMessage,
        );

      // Don't retry non-transient errors (e.g., validation, auth, query errors)
      if (!isTransient) {
        throw lastError;
      }

      // Don't wait after final attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate delay with jitter
      let currentDelayMs = Math.min(delayMs, maxDelayMs);
      const jitter = currentDelayMs * 0.2 * (Math.random() - 0.5) * 2;
      currentDelayMs = Math.max(1, currentDelayMs + jitter);

      console.warn(
        `[Workers-DB-Retry] Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}. ` +
          `Retrying in ${currentDelayMs.toFixed(0)}ms...`,
      );

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, currentDelayMs));

      // Increase delay exponentially for next attempt
      delayMs *= 2;
    }
  }

  // All retries exhausted
  throw lastError || new Error('Database operation failed after max retries');
}

/**
 * Create a SQL function with built-in retry logic
 *
 * Returns a function that automatically retries on connection errors.
 *
 * @param sqlFn - The Neon SQL function from @neondatabase/serverless
 * @returns Wrapped version with retry logic
 *
 * @example
 * ```typescript
 * const sqlWithRetry = createRetryableSql(sql);
 * const results = await sqlWithRetry`SELECT * FROM products WHERE id = ${id}`;
 * ```
 */
export function createRetryableSql<TResult>(
  sqlFn: SqlTaggedTemplate<TResult>,
  options: WorkersDbRetryOptions = {},
) {
  return (strings: TemplateStringsArray, ...values: unknown[]): Promise<TResult> => {
    return withNeonRetry(() => Promise.resolve(sqlFn(strings, ...values)), options);
  };
}

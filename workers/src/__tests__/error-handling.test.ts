/**
 * Coverage for `utils/db-retry.ts` — the Neon transient-failure retry helper.
 *
 * **This file used to be much larger, and almost none of it tested anything.**
 * It was written against `workers/src/handlers/*`, a layer with no production
 * importer, deleted as dead code alongside this trim. Of its original ~20 tests,
 * ten asserted `expect(true).toBe(true)` under a descriptive name, four called a
 * deleted handler inside a try/catch that asserted in BOTH branches (so they
 * could not fail), and two were `skipIf(!NEON_CONNECTION_STRING)` and never ran
 * in CI. Only the four below exercise real behaviour, and the file keeps its
 * path so the 2.2 manifests' "searched here" entries stay accurate.
 *
 * **`withNeonRetry` is not wired into the live path.** Its only importers were
 * the three deleted handlers; `database.ts` calls `neon()` directly with no
 * retry, so the deployed Worker has no transient-failure handling against Neon
 * at all. The module is retained rather than deleted because it is a working,
 * tested implementation of a gap the live path actually has — adopting it (or
 * deciding not to) is tracked as its own task, not settled here.
 */
import { describe, it, expect } from 'vitest';
import { withNeonRetry } from '../utils/db-retry';

describe('withNeonRetry', () => {
  it('retries a transient connection error and returns the eventual success', async () => {
    let attemptCount = 0;

    const result = await withNeonRetry(
      async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('connection refused');
        }
        return [{ id: 1, name: 'Test' }];
      },
      { initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(attemptCount).toBe(3);
    expect(result).toEqual([{ id: 1, name: 'Test' }]);
  });

  it('retries a connection timeout and rethrows the last error at the attempt limit', async () => {
    let attemptCount = 0;

    await expect(
      withNeonRetry(
        async () => {
          attemptCount++;
          throw new Error('connection timeout');
        },
        { initialDelayMs: 1, maxDelayMs: 1 },
      ),
    ).rejects.toThrow('connection timeout');

    expect(attemptCount).toBe(3);
  });

  // The retry limit is the point: an unbounded retry against a genuinely down
  // database burns the Worker's CPU budget instead of failing fast.
  it('stops at three attempts rather than retrying indefinitely', async () => {
    let attemptCount = 0;

    await expect(
      withNeonRetry(
        async () => {
          attemptCount++;
          throw new Error('connection refused');
        },
        { initialDelayMs: 1, maxDelayMs: 1 },
      ),
    ).rejects.toThrow('connection refused');

    expect(attemptCount).toBe(3);
  });

  it('retries Neon connection-exhaustion errors', async () => {
    let attemptCount = 0;

    const result = await withNeonRetry(
      async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('too many connections');
        }
        return [{ count: 5 }];
      },
      { initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(attemptCount).toBe(2);
    expect(result).toEqual([{ count: 5 }]);
  });
});

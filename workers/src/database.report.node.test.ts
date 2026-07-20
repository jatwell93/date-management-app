import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './types/env';

const sqlMock = vi.hoisted(() => vi.fn());
const capturedQueries = vi.hoisted((): string[] => []);

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
}));

import { createWorkersDatabase } from './database';

const createEnv = (): Env =>
  ({
    NEON_CONNECTION_STRING: 'postgresql://user:password@db.example.com/app?sslmode=require',
  }) as Env;

const expectBackendAlignedExpiryQuery = (query: string) => {
  expect(query).toContain('expiry_risk_count');
  expect(query).toContain('next_month_markdown_count');
  expect(query).toContain('active_expiry_stock_count');
  expect(query).toContain('expiry_date::date - CURRENT_DATE');
  expect(query).toContain('COUNT(*) FILTER');
  expect(query).toContain('days_to_expiry BETWEEN 0 AND 30');
  expect(query).toContain('days_to_expiry BETWEEN 31 AND 60');
  expect(query).toContain('days_to_expiry BETWEEN 61 AND 90');
  expect(query).toContain('days_to_expiry BETWEEN 91 AND 120');
  expect(query).not.toContain("status = 'Markdown 1'");
  expect(query).not.toContain("status LIKE 'Markdown%'");
};

describe('Workers report database queries', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    sqlMock.mockReset();
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedQueries.push(
        strings.reduce((query, chunk, index) => `${query}${chunk}${values[index] ?? ''}`, ''),
      );
      return Promise.resolve([]);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('keeps monthly expiry report SQL aligned with the backend expiry-window contract', async () => {
    const db = createWorkersDatabase(createEnv());

    await db.getMonthlyExpiryReport('test-org');

    expectBackendAlignedExpiryQuery(capturedQueries[0]);
  });

  it('returns overall expiry fallback data with the frontend-required summary fields', async () => {
    const db = createWorkersDatabase(createEnv());

    const report = await db.getOverallExpiryReport('test-org');

    expect(report).toMatchObject({
      expiry_risk_count: 0,
      next_month_markdown_count: 0,
      active_expiry_stock_count: 0,
    });
    expectBackendAlignedExpiryQuery(capturedQueries[0]);
  });
});

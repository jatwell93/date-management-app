/**
 * Coverage for Worker configuration validation (task 3.1.o).
 *
 * The property most worth pinning is the one a naive required-list gets wrong:
 * the database capability has three possible sources, so checking for
 * `NEON_CONNECTION_STRING` by name would report a working Hyperdrive-only
 * deployment as broken. A false alarm here is worse than no alarm, because it
 * trains an operator to ignore the output.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types/env';
import {
  describeConfigProblems,
  logConfigOnce,
  resetConfigLogForTests,
  validateWorkerConfig,
} from './env-validation';

const complete = () =>
  ({
    NEON_CONNECTION_STRING: 'postgres://example',
    JWT_SECRET: 'secret',
    CLERK_SECRET_KEY: 'sk_test',
    CLERK_WEBHOOK_SECRET: 'whsec_clerk',
    STRIPE_WEBHOOK_SECRET: 'whsec_stripe',
    CSV_UPLOADS: {} as unknown,
    RESEND_API_KEY: 're_key',
  }) as unknown as Env;

describe('validateWorkerConfig', () => {
  it('passes a fully configured environment', () => {
    expect(validateWorkerConfig(complete())).toEqual({
      ok: true,
      missingRequired: [],
      missingFeatures: [],
    });
  });

  it('accepts DATABASE_URL as the database source', () => {
    const env = { ...complete(), NEON_CONNECTION_STRING: undefined, DATABASE_URL: 'postgres://x' };
    expect(validateWorkerConfig(env as unknown as Env).ok).toBe(true);
  });

  it('accepts a Hyperdrive binding as the database source', () => {
    // The case a by-name required-list would report as a false failure.
    const env = {
      ...complete(),
      NEON_CONNECTION_STRING: undefined,
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive' },
    };
    expect(validateWorkerConfig(env as unknown as Env).ok).toBe(true);
  });

  it('fails when no database source is available at all', () => {
    const env = { ...complete(), NEON_CONNECTION_STRING: undefined };
    const result = validateWorkerConfig(env as unknown as Env);

    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContain('NEON_CONNECTION_STRING | DATABASE_URL | HYPERDRIVE');
  });

  it('fails on a missing JWT_SECRET', () => {
    const env = { ...complete(), JWT_SECRET: '' };
    const result = validateWorkerConfig(env as unknown as Env);

    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContain('JWT_SECRET');
  });

  it('treats a whitespace-only secret as missing', () => {
    const env = { ...complete(), JWT_SECRET: '   ' };
    expect(validateWorkerConfig(env as unknown as Env).ok).toBe(false);
  });

  it('reports missing feature keys without failing the deployment', () => {
    // A deployment without Resend is a valid deployment with email off.
    const env = { ...complete(), RESEND_API_KEY: undefined };
    const result = validateWorkerConfig(env as unknown as Env);

    expect(result.ok).toBe(true);
    expect(result.missingFeatures).toEqual(['RESEND_API_KEY']);
  });

  it('reports a missing R2 binding as a feature gap', () => {
    const env = { ...complete(), CSV_UPLOADS: undefined };
    const result = validateWorkerConfig(env as unknown as Env);

    expect(result.ok).toBe(true);
    expect(result.missingFeatures).toContain('CSV_UPLOADS');
  });
});

describe('describeConfigProblems', () => {
  it('names the impact, not only the key', () => {
    const env = { ...complete(), JWT_SECRET: '' };
    const lines = describeConfigProblems(env as unknown as Env);

    expect(lines.some((l) => l.includes('MISSING REQUIRED JWT_SECRET'))).toBe(true);
    expect(lines.some((l) => l.includes('authenticated API routes'))).toBe(true);
  });

  it('says nothing about a healthy configuration', () => {
    expect(describeConfigProblems(complete())).toEqual([]);
  });
});

describe('logConfigOnce', () => {
  beforeEach(() => {
    resetConfigLogForTests();
  });

  it('logs an error once per isolate for a broken configuration', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...complete(), JWT_SECRET: '' } as unknown as Env;

    logConfigOnce(env);
    logConfigOnce(env);
    logConfigOnce(env);

    // Once, not three times: a Worker isolate serves many requests and this
    // would otherwise bury the signal and cost money on a paid logging plan.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('worker_config_invalid');
    error.mockRestore();
  });

  it('warns rather than errors when only features are missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logConfigOnce({ ...complete(), RESEND_API_KEY: undefined } as unknown as Env);

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('worker_config_features_disabled');
    error.mockRestore();
    warn.mockRestore();
  });

  it('stays silent on a fully configured environment', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logConfigOnce(complete());

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });
});

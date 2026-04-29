/**
 * Regression tests for getClerkAuthorizedParties
 *
 * Ensures that:
 *  - Production keeps a strict static allowlist (no dynamic preview origins).
 *  - Non-production accepts dynamic Cloudflare Pages preview origins matching
 *    this project's pages.dev base host, so per-build preview URLs work.
 *  - Untrusted Origin headers (other tenants, http, malformed) are rejected.
 */
import { describe, it, expect } from 'vitest';
import type { Env } from '../types/env';
import { getClerkAuthorizedParties } from '../index-minimal';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'development',
    STORAGE_PROVIDER: 'r2',
    MAX_FILE_SIZE: '10485760',
    CSV_BATCH_SIZE: '100',
    RATE_LIMIT_WINDOW: '60000',
    RATE_LIMIT_MAX_REQUESTS: '100',
    RATE_LIMIT_MAX_AUTHENTICATED: '1000',
    NEON_CONNECTION_STRING: 'postgres://test',
    JWT_SECRET: 'test-secret',
    CLERK_WEBHOOK_SECRET: 'whsec_test',
    R2_ACCOUNT_ID: 'a',
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_BUCKET_NAME: 'b',
    FRONTEND_URL: 'https://date-management-frontend.pages.dev',
    CSV_UPLOADS: {} as unknown as R2Bucket,
    HYPERDRIVE: {} as unknown as Hyperdrive,
    ...overrides,
  } as Env;
}

describe('getClerkAuthorizedParties', () => {
  it('always includes localhost dev origins', () => {
    const parties = getClerkAuthorizedParties(makeEnv());
    expect(parties).toContain('http://localhost:3002');
    expect(parties).toContain('http://127.0.0.1:3002');
  });

  it('includes FRONTEND_URL when configured', () => {
    const parties = getClerkAuthorizedParties(
      makeEnv({
        FRONTEND_URL: 'https://app.example.com',
      }),
    );
    expect(parties).toContain('https://app.example.com');
  });

  describe('non-production preview origins', () => {
    it('accepts dynamic *.pages.dev preview origin matching project base host', () => {
      const env = makeEnv({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://date-management-frontend.pages.dev',
      });
      const previewOrigin = 'https://7f5e6f1a.date-management-frontend.pages.dev';
      const parties = getClerkAuthorizedParties(env, previewOrigin);
      expect(parties).toContain(previewOrigin);
    });

    it('accepts the project base host itself as an origin', () => {
      const env = makeEnv({ NODE_ENV: 'development' });
      const baseOrigin = 'https://date-management-frontend.pages.dev';
      const parties = getClerkAuthorizedParties(env, baseOrigin);
      expect(parties).toContain(baseOrigin);
    });

    it('derives base host from FRONTEND_URL when it is a pages.dev URL', () => {
      const env = makeEnv({
        NODE_ENV: 'staging',
        FRONTEND_URL: 'https://my-other-project.pages.dev',
      });
      const previewOrigin = 'https://abc123.my-other-project.pages.dev';
      const parties = getClerkAuthorizedParties(env, previewOrigin);
      expect(parties).toContain(previewOrigin);
    });

    it('rejects pages.dev hosts from a different project', () => {
      const env = makeEnv({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://date-management-frontend.pages.dev',
      });
      const foreignOrigin = 'https://attacker.pages.dev';
      const parties = getClerkAuthorizedParties(env, foreignOrigin);
      expect(parties).not.toContain(foreignOrigin);
    });

    it('rejects http preview origins (only https is trusted)', () => {
      const env = makeEnv({ NODE_ENV: 'development' });
      const httpOrigin = 'http://7f5e6f1a.date-management-frontend.pages.dev';
      const parties = getClerkAuthorizedParties(env, httpOrigin);
      expect(parties).not.toContain(httpOrigin);
    });

    it('ignores malformed Origin header without throwing', () => {
      const env = makeEnv({ NODE_ENV: 'development' });
      expect(() => getClerkAuthorizedParties(env, 'not a url')).not.toThrow();
    });
  });

  describe('production', () => {
    it('does NOT add dynamic preview origins even if Origin matches base host', () => {
      const env = makeEnv({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.example.com',
      });
      const previewOrigin = 'https://7f5e6f1a.date-management-frontend.pages.dev';
      const parties = getClerkAuthorizedParties(env, previewOrigin);
      expect(parties).not.toContain(previewOrigin);
      expect(parties).toContain('https://app.example.com');
    });
  });
});

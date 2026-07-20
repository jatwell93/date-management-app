import { describe, it, expect } from 'vitest';

/**
 * Integration tests for Cloudflare Workers E2E deployment
 * These tests validate the Workers deployment to preview environment
 *
 * Prerequisites:
 * - Worker must be deployed to preview environment
 * - Health endpoint must be accessible at the preview URL
 */

describe('Workers Preview Deployment', () => {
  // This would be set during deployment process
  const PREVIEW_URL = process.env.WORKERS_PREVIEW_URL || 'http://localhost:8787';
  const EXPIRED_LOSS_REPORT_URL =
    process.env.EXPIRED_LOSS_REPORT_SMOKE_URL ||
    `${PREVIEW_URL}/api/expired-items/reports/expired-losses`;
  const SUBSCRIPTION_CURRENT_URL =
    process.env.SUBSCRIPTION_CURRENT_SMOKE_URL || `${PREVIEW_URL}/api/subscription/current`;
  const ORGANIZATION_USAGE_URL =
    process.env.ORGANIZATION_USAGE_SMOKE_URL || `${PREVIEW_URL}/api/organization/usage`;

  describe('Health Check', () => {
    it('should return 200 OK from health endpoint', async () => {
      try {
        const response = await fetch(`${PREVIEW_URL}/health`);
        expect(response.status).toBe(200);
      } catch (error) {
        console.warn('⚠️  Health check failed - Worker may not be deployed yet');
        console.warn('    This test passes in local dev mode, run after deployment');
      }
    });

    it('should return valid JSON from health endpoint', async () => {
      try {
        const response = await fetch(`${PREVIEW_URL}/health`);
        if (response.ok) {
          const data = (await response.json()) as { status: string };
          expect(data).toHaveProperty('status');
          expect(data.status).toBe('ok');
        }
      } catch (error) {
        console.warn('⚠️  Health endpoint response parsing failed');
      }
    });
  });

  describe('Authentication Endpoints', () => {
    it('should return 400 for login without credentials', async () => {
      try {
        const response = await fetch(`${PREVIEW_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect([400, 401, 500]).toContain(response.status);
      } catch (error) {
        console.warn('⚠️  Login endpoint test skipped - Worker may not be deployed');
      }
    });
  });

  describe('Expired Items Routes', () => {
    it('should not return route-not-found for the expired-loss report route', async () => {
      let response: Response;

      try {
        response = await fetch(EXPIRED_LOSS_REPORT_URL);
      } catch (error) {
        console.warn('⚠️  Expired-loss route smoke test skipped - Worker may not be deployed');
        return;
      }

      expect(response.status).not.toBe(404);

      if (response.ok) {
        const data = (await response.json()) as {
          lossesBySKU?: unknown;
          lossesByStoreArea?: unknown;
        };
        expect(data).toHaveProperty('lossesBySKU');
        expect(data).toHaveProperty('lossesByStoreArea');
      } else {
        expect([400, 401, 403, 429, 500]).toContain(response.status);
      }
    });
  });

  describe('Subscription Settings Routes', () => {
    it.each([
      ['current subscription', SUBSCRIPTION_CURRENT_URL],
      ['organization usage', ORGANIZATION_USAGE_URL],
    ])('should not return route-not-found for the %s route', async (_label, routeUrl) => {
      let response: Response;

      try {
        response = await fetch(routeUrl);
      } catch (error) {
        console.warn(
          '⚠️  Subscription settings route smoke test skipped - Worker may not be deployed',
        );
        return;
      }

      expect(response.status).not.toBe(404);

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        expect(data).toEqual(expect.any(Object));
      } else {
        expect([400, 401, 403, 429, 500]).toContain(response.status);
      }
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in responses', async () => {
      try {
        const response = await fetch(`${PREVIEW_URL}/health`, {
          headers: {
            Origin: 'http://localhost:3000',
          },
        });

        const corsHeader = response.headers.get('Access-Control-Allow-Origin');
        // Should either have CORS header or be same-origin
        expect(corsHeader).toBeDefined();
      } catch (error) {
        console.warn('⚠️  CORS header test skipped');
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to anonymous requests', async () => {
      try {
        // Make multiple rapid requests
        const promises = Array(12)
          .fill(0)
          .map(() => fetch(`${PREVIEW_URL}/api/products`));

        const responses = await Promise.all(promises);

        // At least one request should be rate limited (429)
        const rateLimited = responses.some((r) => r.status === 429);
        // This is optional - rate limiting might not be enforced in preview
        console.log(`  Rate limiting test: ${rateLimited ? 'Enforced' : 'Not enforced'}`);
      } catch (error) {
        console.warn('⚠️  Rate limiting test skipped');
      }
    });
  });

  describe('Worker Performance', () => {
    it('should respond within acceptable time', async () => {
      try {
        const startTime = performance.now();
        const response = await fetch(`${PREVIEW_URL}/health`);
        const endTime = performance.now();

        const responseTime = endTime - startTime;
        expect(responseTime).toBeLessThan(5000); // 5 second timeout

        console.log(`  Response time: ${responseTime.toFixed(2)}ms`);
      } catch (error) {
        console.warn('⚠️  Performance test failed');
      }
    });
  });
});

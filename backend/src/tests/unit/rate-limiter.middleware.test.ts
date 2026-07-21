import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import {
  getRetryAfterIso,
  skipRateLimitForIps,
  skipRateLimitForPaths,
  standardLimiter,
  globalLimiter,
  strictLimiter,
  uploadLimiter,
  checkoutSessionLimiter,
  trialConversionLimiter,
  presignedUrlLimiter,
} from '../../middleware/rateLimiter';

/**
 * The limiters in rateLimiter.ts are module-level singletons with fixed windows,
 * so a limiter can only be exercised by actually exhausting it. Each limiter is
 * driven through a throwaway express app; the in-memory store keys by client IP,
 * so using a distinct X-Forwarded-For per case keeps the buckets independent
 * (and exercises the `x-forwarded-for || req.ip` fallback on both sides).
 */
function appWith(limiter: express.RequestHandler, before?: express.RequestHandler): Express {
  const app = express();
  // Required for express-rate-limit to accept X-Forwarded-For as the client IP.
  app.set('trust proxy', 1);
  if (before) {
    app.use(before);
  }
  app.use(limiter);
  app.get('/resource', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

/**
 * Fires `max + 1` requests concurrently. The memory store increments
 * synchronously, so exactly `max` succeed and the final one is rejected.
 */
async function exhaust(app: Express, max: number, forwardedFor?: string) {
  const send = () => {
    const req = request(app).get('/resource');
    return forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req;
  };
  // Batched rather than one Promise.all: the high-ceiling limiters need >1000
  // requests, and opening that many sockets at once trips EMFILE on Windows.
  const responses = [];
  for (let sent = 0; sent < max + 1; sent += 50) {
    const size = Math.min(50, max + 1 - sent);
    responses.push(...(await Promise.all(Array.from({ length: size }, send))));
  }
  const rejected = responses.filter((r) => r.status === 429);
  const allowed = responses.filter((r) => r.status === 200);
  return { rejected, allowed };
}

describe('rateLimiter middleware', () => {
  describe('getRetryAfterIso', () => {
    it('returns undefined when the request has no rateLimit metadata', () => {
      expect(getRetryAfterIso({} as Request)).toBeUndefined();
    });

    it('returns undefined when resetTime is absent', () => {
      const req = { rateLimit: {} } as unknown as Request;

      expect(getRetryAfterIso(req)).toBeUndefined();
    });

    it('serialises a Date resetTime to ISO', () => {
      const resetTime = new Date('2026-01-01T00:00:00.000Z');
      const req = { rateLimit: { resetTime } } as unknown as Request;

      expect(getRetryAfterIso(req)).toBe('2026-01-01T00:00:00.000Z');
    });

    it('serialises a numeric (epoch ms) resetTime to ISO', () => {
      const resetTime = new Date('2026-01-01T00:00:00.000Z').getTime();
      const req = { rateLimit: { resetTime } } as unknown as Request;

      expect(getRetryAfterIso(req)).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('skipRateLimitForIps', () => {
    it('skips when the first X-Forwarded-For entry is allowed', () => {
      const skip = skipRateLimitForIps(['10.0.0.1']);
      const req = { headers: { 'x-forwarded-for': '10.0.0.1, 70.41.3.18' } } as unknown as Request;

      expect(skip(req)).toBe(true);
    });

    it('does not skip when the forwarded IP is not allowed', () => {
      const skip = skipRateLimitForIps(['10.0.0.1']);
      const req = { headers: { 'x-forwarded-for': '203.0.113.9' } } as unknown as Request;

      expect(skip(req)).toBe(false);
    });

    it('falls back to req.ip when no forwarding header is present', () => {
      const skip = skipRateLimitForIps(['192.168.1.5']);
      const req = { headers: {}, ip: '192.168.1.5' } as unknown as Request;

      expect(skip(req)).toBe(true);
    });

    it('falls back to an empty key when neither header nor req.ip is set', () => {
      const skip = skipRateLimitForIps(['192.168.1.5']);
      const req = { headers: {} } as unknown as Request;

      expect(skip(req)).toBe(false);
    });
  });

  describe('skipRateLimitForPaths', () => {
    it('skips paths matching an allowed prefix', () => {
      const skip = skipRateLimitForPaths(['/health', '/metrics']);

      expect(skip({ path: '/health/live' } as Request)).toBe(true);
    });

    it('does not skip unrelated paths', () => {
      const skip = skipRateLimitForPaths(['/health']);

      expect(skip({ path: '/api/products' } as Request)).toBe(false);
    });

    it('does not skip when the allow list is empty', () => {
      const skip = skipRateLimitForPaths([]);

      expect(skip({ path: '/health' } as Request)).toBe(false);
    });
  });

  describe('strictLimiter', () => {
    it('rejects the 6th attempt with a RATE_LIMIT_EXCEEDED payload', async () => {
      const { rejected, allowed } = await exhaust(appWith(strictLimiter), 5, '198.51.100.1');

      expect(allowed).toHaveLength(5);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].body).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many login attempts, please try again later.',
      });
      // resetTime is populated by express-rate-limit, so retryAfter is a real ISO stamp.
      expect(Date.parse(rejected[0].body.retryAfter)).not.toBeNaN();
    });

    it('rate limits by req.ip when no X-Forwarded-For header is sent', async () => {
      // Distinct bucket from the test above (loopback, not 198.51.100.1).
      const { rejected } = await exhaust(appWith(strictLimiter), 5);

      expect(rejected).toHaveLength(1);
      expect(rejected[0].body.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('standardLimiter', () => {
    it('rejects the 101st request in the window', async () => {
      const { rejected, allowed } = await exhaust(appWith(standardLimiter), 100, '198.51.100.7');

      expect(allowed).toHaveLength(100);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].body).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
      });
    });
  });

  describe('globalLimiter', () => {
    it('rejects the 1001st request and omits retryAfter (hits are not logged)', async () => {
      const { rejected } = await exhaust(appWith(globalLimiter), 1000, '198.51.100.8');

      expect(rejected).toHaveLength(1);
      // The global handler deliberately returns a bare payload: no retryAfter and
      // no log line, because at 1000/min the logging would drown everything else.
      expect(rejected[0].body).toEqual({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
      });
    });
  });

  describe('uploadLimiter', () => {
    it('rejects the 11th upload in the window', async () => {
      const { rejected } = await exhaust(appWith(uploadLimiter), 10, '198.51.100.2');

      expect(rejected).toHaveLength(1);
      expect(rejected[0].body).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many uploads from this IP, please try again later.',
      });
    });
  });

  describe('checkoutSessionLimiter', () => {
    it('rejects the 11th checkout attempt in the window', async () => {
      const { rejected } = await exhaust(appWith(checkoutSessionLimiter), 10, '198.51.100.3');

      expect(rejected).toHaveLength(1);
      expect(rejected[0].body.message).toBe('Too many checkout attempts, please try again later.');
    });
  });

  describe('trialConversionLimiter', () => {
    it('rejects the 6th trial conversion attempt in the window', async () => {
      const { rejected } = await exhaust(appWith(trialConversionLimiter), 5, '198.51.100.4');

      expect(rejected).toHaveLength(1);
      expect(rejected[0].body.message).toBe(
        'Too many trial conversion attempts, please try again later.',
      );
    });
  });

  describe('presignedUrlLimiter', () => {
    // SECURITY: this limiter must key on the authenticated user, not the IP —
    // otherwise one tenant behind a shared egress IP can exhaust another's quota.
    // See docs/security-audit.md section 3 "Presigned URL Security".
    const authenticateAs = (organizationId: string, userId: number): express.RequestHandler => {
      return (req, _res, next) => {
        Object.assign(req, { organizationId, userId });
        next();
      };
    };

    it('rejects the 51st request for an authenticated user and sets Retry-After', async () => {
      const app = appWith(presignedUrlLimiter, authenticateAs('org_alpha', 1));

      const { rejected, allowed } = await exhaust(app, 50, '198.51.100.5');

      expect(allowed).toHaveLength(50);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].body).toMatchObject({
        code: 'ERR_RATE_LIMIT_EXCEEDED',
        details: { limit: 50, window: '1 hour', type: 'presigned_url_generation' },
      });
      expect(Number(rejected[0].headers['retry-after'])).toBeGreaterThan(0);
      expect(rejected[0].body.retryAfter).toBeGreaterThan(0);
    });

    it('keys by user, so a second user from the same IP is unaffected', async () => {
      const sharedIp = '198.51.100.5'; // Same egress IP as the exhausted user above.
      const app = appWith(presignedUrlLimiter, authenticateAs('org_beta', 2));

      const res = await request(app).get('/resource').set('X-Forwarded-For', sharedIp);

      expect(res.status).toBe(200);
    });

    it('falls back to an IP-derived key when the request is unauthenticated', async () => {
      const app = appWith(presignedUrlLimiter);

      const { rejected } = await exhaust(app, 50, '198.51.100.6');

      expect(rejected).toHaveLength(1);
      expect(rejected[0].body.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
    });
  });
});

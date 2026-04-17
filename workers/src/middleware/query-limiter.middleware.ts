import { Env } from '../types/env';
import { ExpressMiddleware, ExpressRequest, ExpressResponse } from '../express-adapter';

function isProtectedApiGet(req: ExpressRequest): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  if (!req.path.startsWith('/api/')) {
    return false;
  }

  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/health')) {
    return false;
  }

  return true;
}

function clampLimit(rawLimit: string | undefined, maxResults: number): string {
  const parsed = Number.parseInt(rawLimit ?? String(maxResults), 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return String(maxResults);
  }

  return String(Math.min(parsed, maxResults));
}

export function createQueryLimiter(env: Env): ExpressMiddleware {
  const maxResults = Number.parseInt(env.QUERY_MAX_RESULTS || '100', 10);
  const timeoutMs = Number.parseInt(env.QUERY_TIMEOUT_MS || '10000', 10);

  return (req: ExpressRequest, _res: ExpressResponse, next: () => void) => {
    if (!isProtectedApiGet(req)) {
      next();
      return;
    }

    req.requestTimeoutMs = timeoutMs;

    if (typeof req.query.limit === 'string') {
      req.query.limit = clampLimit(req.query.limit, maxResults);
    }

    next();
  };
}

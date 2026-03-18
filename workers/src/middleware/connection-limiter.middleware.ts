import { Env } from '../types/env';
import { ExpressMiddleware, ExpressRequest, ExpressResponse } from '../express-adapter';

class ConnectionLimiter {
  private activeConnections = 0;
  private readonly maxConcurrentConnections: number;

  constructor(maxConcurrentConnections: number) {
    this.maxConcurrentConnections = maxConcurrentConnections;
  }

  tryAcquire(): boolean {
    if (this.activeConnections >= this.maxConcurrentConnections) {
      return false;
    }

    this.activeConnections += 1;
    return true;
  }

  release(): void {
    if (this.activeConnections > 0) {
      this.activeConnections -= 1;
    }
  }

  getActiveConnections(): number {
    return this.activeConnections;
  }

  getMaxConcurrentConnections(): number {
    return this.maxConcurrentConnections;
  }
}

export function createConnectionLimiter(env: Env): ExpressMiddleware {
  const maxConcurrentConnections = Number.parseInt(env.MAX_CONCURRENT_CONNECTIONS || '50', 10);
  const limiter = new ConnectionLimiter(maxConcurrentConnections);

  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const acquired = limiter.tryAcquire();

    if (!acquired) {
      res.setHeader('Retry-After', '1');
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Server is handling too many concurrent requests. Please retry shortly.',
        activeConnections: limiter.getActiveConnections(),
        maxConcurrentConnections: limiter.getMaxConcurrentConnections(),
      });
      return;
    }

    let released = false;
    const previousRelease = req.releaseConnection;

    req.releaseConnection = () => {
      if (released) {
        return;
      }

      released = true;
      limiter.release();
      if (previousRelease) {
        previousRelease();
      }
    };

    next();
  };
}